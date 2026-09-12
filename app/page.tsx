"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  QwenRealtimeClient,
  type QwenRealtimeStatus,
} from "@/lib/qwen/realtimeClient";
import {
  getFileExtension,
  getAcceptedAudioDescription,
  inferAudioMimeType,
  isSupportedAudioFile,
} from "@/lib/audio/formats";
import {
  float32ToPcm16Base64,
  resampleMonoFloat32,
} from "@/lib/audio/pcm16";

import AudioUploader from "@/components/AudioUploader";
import ListeningHistory from "@/components/ListeningHistory";
import MusicPlayer from "@/components/MusicPlayer";
import type { MusicPlayerHandle } from "@/components/MusicPlayer";
import UserReplyBox, {
  type CommunicationMode,
} from "@/components/UserReplyBox";

import { useLocalAudioFeatures } from "@/hooks/useLocalAudioFeatures";
import { usePcmAudioPlayer } from "@/hooks/usePcmAudioPlayer";
import { useRealtimeMicrophone } from "@/hooks/useRealtimeMicrophone";
import {
  useRealtimeListeningSource,
  type LiveListeningStatus,
} from "@/hooks/useRealtimeListeningSource";

import type {
  LocalAudioFeatures,
  ListeningMessage,
  PlaybackSnapshot,
} from "@/types/music";

const INITIAL_PLAYBACK: PlaybackSnapshot = {
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  isSeeking: false,
};

type CompanionReplyStatus =
  | "idle"
  | "thinking"
  | "streaming"
  | "error";

type QwenMomentStatus =
  | "idle"
  | "connected"
  | "commenting"
  | "error";

type QwenPromptKind = "user_reply" | "proactive_comment";

type ListeningInputMode =
  | "file"
  | "local_speaker"
  | "nearby_speaker";

type PendingQwenPrompt = {
  prompt: string;
  musicTimeSeconds: number;
  kind: QwenPromptKind;
};

const QWEN_COMMENT_COOLDOWN_MS = 5000;
const QWEN_POST_SPEECH_COOLDOWN_MS = 3000;
const QWEN_RESPONSE_DEADLINE_MS = 25000;
const PROACTIVE_COMMENT_INTERVAL_SECONDS = 12;
const MIN_PROACTIVE_AUDIO_SECONDS = 6;
const MIN_PROACTIVE_COMMENT_SECOND = 4;
const FIRST_COMMENT_REQUEST_DEADLINE_SECOND = 16;
const SOUND_START_GRACE_SECONDS = 2;
const AUDIBLE_RMS_THRESHOLD = 0.018;
const LIVE_AUDIBLE_RMS_THRESHOLD = 0.003;
const LIVE_AUDIO_CONTINUITY_GAP_MS = 1500;
const LIVE_AUDIO_REQUIRED_MS = 1200;
const LIVE_AUDIO_RECENT_MS = 2500;
const LIVE_FIRST_COMMENT_DELAY_MS = 3500;

function canUseServerAudioTranscode() {
  return (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
}

function createMessageId(): string {
  if (
    typeof crypto !== "undefined" &&
    "randomUUID" in crypto
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function getRealtimeStatusText(
  status: QwenRealtimeStatus | "not_started",
): string {
  const statusText: Record<
    QwenRealtimeStatus | "not_started",
    string
  > = {
    not_started: "千问 Realtime 未连接",
    idle: "千问 Realtime 空闲",
    connecting: "千问 Realtime 连接中",
    connected: "千问 Realtime 已连接",
    configured: "千问 Realtime 已准备好",
    streaming: "千问 Realtime 正在响应",
    closed: "千问 Realtime 已断开",
    error: "千问 Realtime 出错",
  };

  return statusText[status] ?? status;
}

function getQwenMomentStatusText(status: QwenMomentStatus) {
  if (status === "connected") {
    return "Realtime 已连接。播放时会默认把真实歌曲交给千问聆听。";
  }

  if (status === "commenting") {
    return "千问正在直接听人声、歌词和音乐，并生成有声回复。";
  }

  if (status === "error") {
    return "Realtime 连接不稳定，暂时无法请求千问。";
  }

  return "无需开启选项；播放后千问会自动听歌曲和歌词。";
}

function normalizeText(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。！？!?、,.]/g, "");
}

function isDuplicateCompanionReply(
  nextText: string,
  previousMessages: ListeningMessage[],
) {
  const cleanNextText = normalizeText(nextText);

  if (!cleanNextText) {
    return true;
  }

  const previousCompanionMessage = previousMessages.findLast(
    (message) => message.sender === "companion",
  );
  return previousCompanionMessage
    ? normalizeText(previousCompanionMessage.text) === cleanNextText
    : false;
}

function formatPlaybackTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const restSeconds = safeSeconds % 60;

  return `${minutes}:${restSeconds.toString().padStart(2, "0")}`;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function createTranscodedFileName(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  const baseName =
    dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;

  return `${baseName}-converted.wav`;
}

function getAudioFileListeningHint(fileName: string) {
  const normalizedFileName = fileName.toLowerCase();

  if (
    normalizedFileName.includes("倒放") ||
    normalizedFileName.includes("反放") ||
    normalizedFileName.includes("reverse")
  ) {
    return "文件名提示这段音频可能经过倒放；如果当前上下文没有冲突，可以直接反应“这个是倒放吧！”，不必展开技术解释。";
  }

  return null;
}

function formatLocalAudioFeatures(
  features: LocalAudioFeatures | null,
  currentTimeSeconds: number,
) {
  if (!features) {
    return "本地音频特征还在分析中或暂不可用。";
  }

  const listeningGuard = getListeningGuardText(
    features,
    currentTimeSeconds,
  );
  const soundStartSecond =
    getEstimatedSoundStartSecond(features);

  return [
    `浏览器本地分析时长：${
      features.durationSeconds
        ? formatPlaybackTime(features.durationSeconds)
        : "未知"
    }`,
    `采样率：${
      features.sampleRate ? `${features.sampleRate} Hz` : "未知"
    }`,
    `估计声音开始：${
      soundStartSecond === null
        ? "未知"
        : formatPlaybackTime(soundStartSecond)
    }`,
    `听感判断约束：${listeningGuard}`,
    `分析说明：${features.analysisNote}`,
  ].join("\n");
}

function getEstimatedSoundStartSecond(
  features: LocalAudioFeatures | null,
) {
  if (!features?.volumeMoments.length) {
    return null;
  }

  const moment = features.volumeMoments.find(
    (item) => item.rms >= AUDIBLE_RMS_THRESHOLD,
  );

  return moment?.timeSeconds ?? null;
}

function isAudibleAroundCurrentTime(
  features: LocalAudioFeatures | null,
  currentTimeSeconds: number,
) {
  if (!features?.volumeMoments.length) {
    return true;
  }

  const currentSecond = Math.floor(currentTimeSeconds);
  const nearbyMoments = features.volumeMoments.filter(
    (moment) =>
      Math.abs(moment.timeSeconds - currentSecond) <= 1,
  );

  if (!nearbyMoments.length) {
    return true;
  }

  return nearbyMoments.some(
    (moment) => moment.rms >= AUDIBLE_RMS_THRESHOLD,
  );
}

function getAverageBandShare(
  features: LocalAudioFeatures,
  key: "lowBassShare" | "upperMidShare",
) {
  const values = features.volumeMoments
    .filter((moment) => moment.rms >= AUDIBLE_RMS_THRESHOLD)
    .map((moment) => moment[key])
    .filter((value): value is number => typeof value === "number");

  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) /
    values.length;
}

function getListeningGuardText(
  features: LocalAudioFeatures,
  currentTimeSeconds: number,
) {
  const moments = features.volumeMoments;

  if (!moments.length) {
    return "没有频段证据，不要猜测刺耳、震耳或激情。";
  }

  const currentIndex = moments.findIndex(
    (moment) =>
      moment.timeSeconds >= Math.floor(currentTimeSeconds),
  );
  const safeIndex =
    currentIndex >= 0 ? currentIndex : moments.length - 1;
  const current = moments[safeIndex];
  const previous = safeIndex > 0 ? moments[safeIndex - 1] : null;
  const volumeDifference = previous
    ? current.rms - previous.rms
    : 0;
  const volumeRatio =
    previous && previous.rms > 0.001
      ? current.rms / previous.rms
      : 1;
  const hasVolumeJump =
    volumeDifference > 0.035 || volumeRatio > 1.8;
  const isLoud = current.rms >= 0.1;
  const isOpening = current.timeSeconds <= 2;
  const averageUpperMid = getAverageBandShare(
    features,
    "upperMidShare",
  );
  const averageLowBass = getAverageBandShare(
    features,
    "lowBassShare",
  );
  const hasUpperMidPeak =
    typeof current.upperMidShare === "number" &&
    current.upperMidShare >= 0.18 &&
    (averageUpperMid === null ||
      current.upperMidShare >= averageUpperMid * 1.35);
  const hasLowBassPeak =
    typeof current.lowBassShare === "number" &&
    current.lowBassShare >= 0.16 &&
    (averageLowBass === null ||
      current.lowBassShare >= averageLowBass * 1.35);

  if (isLoud && hasUpperMidPeak && (!isOpening || hasVolumeJump)) {
    return "当前较响且2–5kHz中高频明显突出，可以谨慎描述尖锐感；不要报告技术数据。";
  }

  if (isLoud && hasLowBassPeak && hasVolumeJump) {
    return "当前较响、40–120Hz低频突出且有音量冲击，可以谨慎描述低音震感；不要报告技术数据。";
  }

  if (isOpening && !hasVolumeJump && !isLoud) {
    return "开头音量不大且没有明显落差，禁止说刺耳、震耳或有激情。";
  }

  if (isLoud || hasVolumeJump) {
    return "只有响度或音量变化，没有足够频段证据；不能据此说刺耳、震耳、激情或难听。";
  }

  return "没有明显响度或频段异常；不要主动评价刺耳、震耳、激情、好听或难听。";
}

function getEarliestProactiveCommentSecond(
  features: LocalAudioFeatures | null,
) {
  const soundStartSecond =
    getEstimatedSoundStartSecond(features);

  if (soundStartSecond === null) {
    return 8;
  }

  return Math.min(
    FIRST_COMMENT_REQUEST_DEADLINE_SECOND,
    Math.max(
      MIN_PROACTIVE_COMMENT_SECOND,
      soundStartSecond + SOUND_START_GRACE_SECONDS,
    ),
  );
}

function getHumanReplyGuide(
  kind: QwenPromptKind,
) {
  const baseGuide = [
    "回复风格：像真人正在一起听，不像乐评、不像作文、不像客服。",
    "可以真情流露，但不要套固定句式或复用本地提示措辞。",
    "每句都要落到具体声音对象、具体变化动作或具体风格依据上；不能只说变活了、清爽、舒服、有感觉。",
    "评论结构优先是：听到的对象/位置 + 它发生了什么 + 你的即时反应。缺任一部分时，宁可短也不要空泛。",
    "表达参考：可以像“哇，这个咚的一声低音感觉让人心里一颤”“诶，这一句有点意思，很国风的感觉”“后面背景里那个像拨弦的声音好好听，有点像琵琶”这样，把声音、变化和感受说清楚。",
    "如果判断风格，要说出风格名称和依据；如果判断乐器感，只能用不确定表达，并说明依据来自当前听感。",
    "如果没有足够线索，就只基于声音大小、进入、停顿、重复听感这类确定能支持的内容回应。",
    "本轮收到的歌曲原音是第一手证据。回答前完整检查本轮音频从开头到结尾是否出现演唱；一旦出现人声，要优先辨认能确认的歌词片段，并结合唱法、语气与音乐分析。",
    "人声存在和歌词是否逐字清楚是两件事：听见演唱但个别字被伴奏遮住时，要先明确有人在唱，再说能确认的词句或唱腔，不能笼统说“没听到歌词”“没有清晰人声”。",
    "主动短评中不要把暂时没辨清字词当成值得播报的结论；如果没有把握确认歌词，就评论本轮确实听到的唱腔、节奏或配器，不要主动说没有歌词。不得从文件名、歌曲常识或外部歌词补全没有亲耳听清的内容。",
    "每一轮都以最新收到的音频为准：即使前一轮还在前奏或曾判断没有演唱，只要这一轮后段出现人声，就必须更新判断，不能沿用上一轮的“没有歌词”。",
    "响度和频率不是一回事：声音大只代表响，不能自动判断为刺耳、震耳、激情、好听或难听。",
    "只有当前声音较响，并且2–5kHz中高频相对本曲平均明显突出时，才可以谨慎描述尖锐或刺耳；开头几秒没有明显音量落差且声音不大时，禁止说刺耳。",
    "只有40–120Hz低频明显突出，同时整体音量有冲击变化时，才可以描述低音压迫或震感，不能把低频震感说成刺耳。",
    "只有持续增强、明显节奏推动或多种声音集中进入等证据，才可以说有激情，不能只因为某一秒声音大。",
    "好听和难听是主观感受，不能伪装成客观检测结论；表达个人感受时必须指出具体声音或变化依据，证据不足就不要下结论。",
    "听感判断约束是内部纠错信息，不是评论主题；回复中不要报告Hz、频段占比、RMS、音量数值或检测结果。",
  ];

  if (kind === "user_reply") {
    return [
      ...baseGuide,
      "本轮新提交的音频只包含用户的麦克风录音，必须把它理解为用户说的话。歌曲由之前的自动听歌轮次提供，禁止把歌曲演唱或历史歌词冒充成用户本轮评论。",
      "用户消息是当前最高优先级：必须先直接回答用户实际问的问题，不能跳过问题另起一条无关的音乐短评；回答完整后还有必要时，才顺带补充当前听感。",
      "如果用户要求听歌词、问唱了什么或某一句是什么，答案主体必须是当前音频中能确认的歌词内容；禁止只回复“很温柔”“很好听”“很有感觉”等感叹。听不清时要指出能确认的字词和不确定的位置，不能编造。",
      "如果用户问“为什么”“怎么听出来的”“哪里像”“怎么确定”或“依据是什么”，必须承接最近一条相关判断：先明确说正在解释哪个结论，再给出上下文中已有的具体声音、节奏、开头、唱腔或变化依据，最后说明它为什么让人产生这种联想。",
      "解释判断时至少形成“具体线索 + 听感作用 + 原结论”的因果关系，例如：“你看，这个热烈的节奏，还有开头那一声，听着特别有冲劲，就很容易让人联想到东北。”可以达到这种具体程度，但不能机械照抄例句。",
      "如果最近的判断缺少足够依据，要坦白说那只是听感联想，再说清目前真正能支持的线索；不要为了回答而编造歌词、乐器、地域或声音细节。",
    ].join("\n");
  }

  return [
    ...baseGuide,
    "主动短评时，不要像定时播报；像听到这一刻忍不住冒出一句话。当前附近没明显声音时不要急着评价。",
  ].join("\n");
}

function getUserRequestFocusGuide(userText?: string) {
  const text = userText?.trim() ?? "";
  const asksForLyrics =
    /歌词|唱(?:了|的)?什么|听清.{0,4}唱|这(?:一)?句.{0,4}什么|歌里.{0,4}(?:说|唱)/u.test(
      text,
    );

  if (asksForLyrics) {
    return "用户正在询问歌词。第一句就直接给出当前音频中能确认的歌词原词或片段；禁止用演唱很温柔、好听、有感觉等听感评价代替答案。若只能听清一部分，就明确写出听清的部分与不确定处。";
  }

  return "先完成用户这句话里的明确要求，再考虑是否需要补充听感；禁止用泛泛的感叹或无关音乐短评代替答案。";
}

function buildQwenPrompt({
  kind,
  audioFile,
  listeningSource,
  playback,
  messages,
  localAudioFeatures,
  userText,
  textOnlyReply = false,
  isRevisitedSegment = false,
}: {
  kind: QwenPromptKind;
  audioFile: File | null;
  listeningSource?: ListeningInputMode;
  playback: PlaybackSnapshot;
  messages: ListeningMessage[];
  localAudioFeatures: LocalAudioFeatures | null;
  userText?: string;
  textOnlyReply?: boolean;
  isRevisitedSegment?: boolean;
}) {
  const currentTime = formatPlaybackTime(playback.currentTime);
  const duration = playback.duration
    ? formatPlaybackTime(playback.duration)
    : "未知";
  const recentMessages = messages.slice(-10);
  const fileListeningHint = audioFile
    ? getAudioFileListeningHint(audioFile.name)
    : "";
  const history =
    recentMessages.length > 0
      ? recentMessages
          .map((message) => {
            const speaker =
              message.sender === "user" ? "用户" : "你";
            const messageTime = formatPlaybackTime(
              message.musicTimeSeconds,
            );

            return `${speaker}@${messageTime}：${message.text}`;
          })
          .join("\n")
      : "暂无。";
  const task =
    kind === "user_reply"
      ? `用户刚刚${textOnlyReply ? "输入" : "说"}：${userText ?? ""}\n这是一次对用户问题的直接回复，不是新的主动短评。先回答这句话本身，并结合最近对话解释依据，禁止转移话题。`
      : "现在到达新的播放时间点，请主动给一句真实的陪听短评。";
  const hasReceivedPlaybackAudio =
    listeningSource !== "file" ||
    playback.isPlaying ||
    playback.currentTime > 0;
  const replyRequirement =
    kind === "user_reply"
      ? hasReceivedPlaybackAudio
        ? "回复要求：只输出一到两句自然中文，尽量不超过60个中文字符；先把用户的问题回答清楚；不要输出列表；不要说你无法听音频。"
        : "回复要求：只输出一到两句自然中文，尽量不超过60个中文字符；歌曲尚未实际播放，绝对不能声称听到了旋律、人声或歌词，也不能编造具体音乐内容；如果用户询问歌曲内容，请自然地请用户先开始播放。"
      : "回复要求：只输出一句话，尽量不超过36个中文字符；像普通用户随口说的；不要输出列表；不要说你无法听音频。";
  const playbackContext = isRevisitedSegment
    ? "用户把进度拉回了之前听过的一段；可以意识到这是回听/重复听，但不要机械地说“你又回来了”，要像朋友自然发现这段还是值得再听。"
    : "这是当前正常播放到的新位置。";

  return [
    "你正在和用户一起听歌，请用中文回复。",
    kind === "proactive_comment"
      ? "本轮直接附带刚刚实际播放过的歌曲原音。必须先亲自听音频，再评论其中已经发生的声音；默认留意演唱与歌词，不能只根据本地数值或文件信息猜测。"
      : textOnlyReply
        ? "本轮用户通过文字与你沟通，没有附带新的麦克风录音；可能同时附带截至当前尚未分析的歌曲原音，必须直接完成用户输入的具体要求。"
        : "本轮新附带的音频只有用户麦克风录音；请直接理解并回答用户说的话，不要把历史中的歌曲演唱当成本轮用户语音。",
    replyRequirement,
    ...(kind === "user_reply"
      ? [getUserRequestFocusGuide(userText)]
      : []),
    "具体度要求：不要只给形容词，必须说明“哪里/什么声音/哪种变化”让你产生这个感受。",
    "可以学习表达参考的具体程度，但不要机械照抄；你需要根据当前上下文自己组织一句新的自然评论。",
    "生成前必须逐条对照最近你说过的话：不要重复同一个声音对象、同一种变化判断、同一个形容词或同一个比喻；例如已经说过“像拉长的泡泡”，后续就不能换几个字继续说泡泡或拉长感，应改看节奏、空间、音色、结构或情绪中的其他角度。",
    "如果有明确线索表明音频经过倒放、变速或其他特殊处理，可以直接说“这个是倒放吧！”这类简短自然的判断，不必强行套用完整评论结构；没有线索时不要猜。",
    getHumanReplyGuide(kind),
    `当前听歌来源：${
      listeningSource === "local_speaker"
        ? "电脑内部正在播放的系统或标签页音频"
        : listeningSource === "nearby_speaker"
          ? "手机、音箱或收音机等其他设备外放的音乐，由麦克风收音"
          : "页面内上传的音乐文件"
    }`,
    ...(audioFile ? [`歌曲文件名：${audioFile.name}`] : []),
    ...(fileListeningHint
      ? [`文件线索：${fileListeningHint}`]
      : []),
    ...(audioFile
      ? [
          `文件格式：${inferAudioMimeType(audioFile) || getFileExtension(audioFile.name) || "未知"}`,
          `文件大小：${formatFileSize(audioFile.size)}`,
        ]
      : []),
    `当前播放：${currentTime} / ${duration}`,
    `播放状态：${playback.isPlaying ? "正在播放" : "暂停"}`,
    `实际聆听状态：${
      hasReceivedPlaybackAudio
        ? "已经收到过实际播放的音频"
        : "尚未收到任何实际播放音频；不得依据文件名或离线分析假装听过"
    }`,
    `播放上下文：${playbackContext}`,
    "本地音频特征：",
    hasReceivedPlaybackAudio
      ? formatLocalAudioFeatures(
          localAudioFeatures,
          playback.currentTime,
        )
      : "歌曲尚未播放，暂不提供离线特征作为听感依据。",
    "最近 messages：",
    history,
    "当前任务：",
    task,
  ].join("\n");
}

export default function Home() {
  const [audioFile, setAudioFile] = useState<File | null>(
    null,
  );

  const [playback, setPlayback] =
    useState<PlaybackSnapshot>(INITIAL_PLAYBACK);

  const [listeningMessages, setListeningMessages] =
    useState<ListeningMessage[]>([]);

  const [companionReplyStatus, setCompanionReplyStatus] =
    useState<CompanionReplyStatus>("idle");

  const [companionReplyError, setCompanionReplyError] =
    useState("");

  const [qwenRealtimeStatus, setQwenRealtimeStatus] =
    useState<QwenRealtimeStatus | "not_started">(
      "not_started",
    );

  const [qwenRealtimeError, setQwenRealtimeError] =
    useState("");

  const [audioFileError, setAudioFileError] =
    useState("");

  const [isPreparingAudio, setIsPreparingAudio] =
    useState(false);

  const [qwenMomentStatus, setQwenMomentStatus] =
    useState<QwenMomentStatus>("idle");

  const [isSendingVoice, setIsSendingVoice] = useState(false);

  const [isSendingText, setIsSendingText] = useState(false);

  const [communicationMode, setCommunicationMode] =
    useState<CommunicationMode>("voice");

  const [voiceInputError, setVoiceInputError] = useState("");

  const [listeningInputMode, setListeningInputMode] =
    useState<ListeningInputMode>("file");

  const [isVoiceCallConnected, setIsVoiceCallConnected] =
    useState(false);

  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);

  const qwenClientRef = useRef<QwenRealtimeClient | null>(
    null,
  );

  const qwenVoiceClientRef = useRef<QwenRealtimeClient | null>(
    null,
  );

  const voiceCallActiveRef = useRef(false);

  const liveListeningStartedAtRef = useRef(0);

  const listeningInputModeRef =
    useRef<ListeningInputMode>("file");

  const communicationModeRef =
    useRef<CommunicationMode>("voice");

  const liveListeningStatusRef =
    useRef<LiveListeningStatus>("idle");

  const lastAiReplyVolumeRef = useRef(1);

  const qwenReadyRef = useRef(false);

  const lastRealtimeCommentSecondRef = useRef(0);

  const hasRequestedProactiveCommentRef = useRef(false);

  const previousPlaybackSecondRef = useRef(0);

  const furthestPlaybackSecondRef = useRef(0);

  const revisitedUntilSecondRef = useRef(0);

  const lastQwenReconnectMsRef = useRef(0);

  const scheduledQwenPromptTimeoutRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const qwenResponseTimeoutRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const voiceResponseTimeoutRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduledQwenPromptKindRef =
    useRef<QwenPromptKind | null>(null);

  const lastQwenPromptSentMsRef = useRef(0);

  const lastReplyAudioFinishedMsRef = useRef(0);

  const replyAudioPlayingRef = useRef(false);

  const waitingForQwenResponseRef = useRef(false);

  const activeQwenPromptKindRef =
    useRef<QwenPromptKind | null>(null);

  const qwenResponseMusicTimeRef =
    useRef<number | null>(null);

  const voiceInputMusicTimeRef = useRef<number | null>(null);

  const pendingVoiceHistoryMessageIdRef =
    useRef<string | null>(null);

  const voiceTurnActiveRef = useRef(false);

  const voiceRecordingActiveRef = useRef(false);

  const voiceResponseActiveRef = useRef(false);

  const liveAudibleStartedAtRef = useRef(0);

  const liveLastAudibleAtRef = useRef(0);

  const qwenRequestIdRef = useRef(0);

  const playbackRef =
    useRef<PlaybackSnapshot>(INITIAL_PLAYBACK);

  const musicPlayerRef = useRef<MusicPlayerHandle | null>(null);

  const listeningMessagesRef = useRef<ListeningMessage[]>([]);

  const {
    status: localFeatureStatus,
    features: localAudioFeatures,
    analyzeFile: analyzeLocalAudioFeatures,
    reset: resetLocalAudioFeatures,
  } = useLocalAudioFeatures();

  const {
    status: voiceRecorderStatus,
    error: voiceRecorderError,
    inputDeviceLabel,
    isMuted: isMicrophoneMuted,
    setMuted: setMicrophoneMuted,
    start: startRealtimeMicrophone,
    stop: stopRealtimeMicrophone,
  } = useRealtimeMicrophone((audioBase64) => {
    qwenVoiceClientRef.current?.appendVoiceAudio(audioBase64);
  });

  const {
    status: liveListeningStatus,
    error: liveListeningError,
    label: liveListeningLabel,
    compatibilityNotice: liveListeningCompatibilityNotice,
    setMuted: setListeningMicrophoneMuted,
    start: startLiveListening,
    stop: stopLiveListening,
  } = useRealtimeListeningSource((audioBase64, rms) => {
    qwenClientRef.current?.appendMusicAudio(audioBase64);
    const now = Date.now();
    if (liveListeningStartedAtRef.current === 0) {
      liveListeningStartedAtRef.current = now;
    }
    if (rms < LIVE_AUDIBLE_RMS_THRESHOLD) return;

    if (
      now - liveLastAudibleAtRef.current >
      LIVE_AUDIO_CONTINUITY_GAP_MS
    ) {
      liveAudibleStartedAtRef.current = now;
    }
    liveLastAudibleAtRef.current = now;
  });

  const hasRecentSustainedLiveAudio = useCallback(() => {
    const now = Date.now();
    return (
      liveAudibleStartedAtRef.current > 0 &&
      now - liveAudibleStartedAtRef.current >=
        LIVE_AUDIO_REQUIRED_MS &&
      now - liveLastAudibleAtRef.current <= LIVE_AUDIO_RECENT_MS
    );
  }, []);

  const {
    isPlaying: isPlayingReply,
    volume: aiReplyVolume,
    setVolume: setAiReplyVolume,
    prepare: prepareReplyAudio,
    begin: beginReplyAudio,
    append: appendReplyAudio,
    finish: finishReplyAudio,
    stop: stopReplyAudio,
  } = usePcmAudioPlayer();

  const clearQwenResponseWatchdog = useCallback(() => {
    if (qwenResponseTimeoutRef.current) {
      clearTimeout(qwenResponseTimeoutRef.current);
      qwenResponseTimeoutRef.current = null;
    }
  }, []);

  const clearVoiceResponseWatchdog = useCallback(() => {
    if (voiceResponseTimeoutRef.current) {
      clearTimeout(voiceResponseTimeoutRef.current);
      voiceResponseTimeoutRef.current = null;
    }
  }, []);

  const startQwenResponseWatchdog = useCallback(
    (client: QwenRealtimeClient, requestId: number) => {
      clearQwenResponseWatchdog();
      qwenResponseTimeoutRef.current = setTimeout(() => {
        if (qwenRequestIdRef.current !== requestId) return;
        qwenResponseTimeoutRef.current = null;

        if (qwenClientRef.current === client) {
          qwenClientRef.current = null;
        }
        client.disconnect();
        qwenReadyRef.current = false;
        waitingForQwenResponseRef.current = false;
        activeQwenPromptKindRef.current = null;
        qwenResponseMusicTimeRef.current = null;
        setIsSendingText(false);
        stopReplyAudio();
        setQwenRealtimeStatus("error");
        setQwenMomentStatus("error");
        setCompanionReplyStatus("error");
        setCompanionReplyError(
          "这次回复没有完整返回，连接已自动重置，请重新发送。",
        );
        setQwenRealtimeError("Realtime 响应中断，已重置连接。");
      }, QWEN_RESPONSE_DEADLINE_MS);
    },
    [clearQwenResponseWatchdog, stopReplyAudio],
  );

  useEffect(() => {
    if (replyAudioPlayingRef.current && !isPlayingReply) {
      lastReplyAudioFinishedMsRef.current = Date.now();
    }

    replyAudioPlayingRef.current = isPlayingReply;
  }, [isPlayingReply]);

  const trackKey = useMemo(() => {
    if (!audioFile) {
      return "no-track";
    }

    return [
      audioFile.name,
      audioFile.size,
      audioFile.lastModified,
    ].join("-");
  }, [audioFile]);

  const hasAudio = Boolean(audioFile);
  const hasActiveListeningInput =
    listeningInputMode === "file"
      ? hasAudio
      : liveListeningStatus === "listening";

  useEffect(() => {
    playbackRef.current = playback;
  }, [playback]);

  useEffect(() => {
    listeningInputModeRef.current = listeningInputMode;
  }, [listeningInputMode]);

  useEffect(() => {
    communicationModeRef.current = communicationMode;
  }, [communicationMode]);

  useEffect(() => {
    liveListeningStatusRef.current = liveListeningStatus;
  }, [liveListeningStatus]);

  const handlePlaybackStateChange = useCallback(
    (nextPlayback: PlaybackSnapshot) => {
      const previousPlayback = playbackRef.current;
      const playbackJumped =
        Math.abs(
          nextPlayback.currentTime - previousPlayback.currentTime,
        ) > 1.5;
      const playbackStopped =
        previousPlayback.isPlaying && !nextPlayback.isPlaying;

      if (
        playbackJumped ||
        (playbackStopped && !voiceTurnActiveRef.current)
      ) {
        qwenClientRef.current?.clearInputAudio();
      }

      playbackRef.current = nextPlayback;
      setPlayback(nextPlayback);
    },
    [],
  );

  const handlePlaybackAudioChunk = useCallback(
    (samples: Float32Array, sampleRate: number) => {
      if (listeningInputMode !== "file") {
        return;
      }

      const client = qwenClientRef.current;
      if (!client) {
        return;
      }

      const resampled = resampleMonoFloat32(
        samples,
        sampleRate,
      );
      client.appendMusicAudio(
        float32ToPcm16Base64(resampled),
      );
    },
    [listeningInputMode],
  );

  useEffect(() => {
    listeningMessagesRef.current = listeningMessages;
  }, [listeningMessages]);

  useEffect(() => {
    return () => {
      if (scheduledQwenPromptTimeoutRef.current) {
        clearTimeout(scheduledQwenPromptTimeoutRef.current);
        scheduledQwenPromptTimeoutRef.current = null;
      }

      clearQwenResponseWatchdog();
      clearVoiceResponseWatchdog();

      qwenClientRef.current?.disconnect();
      qwenClientRef.current = null;
      qwenReadyRef.current = false;
      qwenVoiceClientRef.current?.disconnect();
      qwenVoiceClientRef.current = null;
      voiceCallActiveRef.current = false;
      voiceRecordingActiveRef.current = false;
      voiceResponseActiveRef.current = false;
      voiceTurnActiveRef.current = false;
      void stopRealtimeMicrophone();
      void stopLiveListening();
    };
  }, [
    clearQwenResponseWatchdog,
    clearVoiceResponseWatchdog,
    stopLiveListening,
    stopRealtimeMicrophone,
  ]);

  const addCompanionMessage = useCallback(
    (
      text: string,
      commentIdPrefix = "companion",
      musicTimeSeconds = playbackRef.current.currentTime,
    ) => {
      const cleanText = text.trim();

      if (!cleanText) {
        return;
      }

      setListeningMessages((previousMessages) => {
        if (
          isDuplicateCompanionReply(
            cleanText,
            previousMessages,
          )
        ) {
          return previousMessages;
        }

        return [
          ...previousMessages,
          {
            id: `${commentIdPrefix}-${Date.now()}`,
            sender: "companion",
            text: cleanText,
            musicTimeSeconds,
            commentId: `${commentIdPrefix}-comment-${Date.now()}`,
          },
        ];
      });
    },
    [],
  );

  const addPendingVoiceHistoryMessage = useCallback(() => {
    const id = createMessageId();
    const message: ListeningMessage = {
      id,
      sender: "user",
      text: "正在识别…",
      musicTimeSeconds:
        voiceInputMusicTimeRef.current ??
        playbackRef.current.currentTime,
    };

    pendingVoiceHistoryMessageIdRef.current = id;
    listeningMessagesRef.current = [
      ...listeningMessagesRef.current,
      message,
    ];
    setListeningMessages(listeningMessagesRef.current);
    return id;
  }, []);

  const updatePendingVoiceHistoryMessage = useCallback(
    (text: string) => {
      const cleanText = text.trim();
      if (!cleanText) return;

      const pendingId = pendingVoiceHistoryMessageIdRef.current;

      setListeningMessages((previousMessages) => {
        if (!pendingId) {
          return [
            ...previousMessages,
            {
              id: createMessageId(),
              sender: "user",
              text: cleanText,
              musicTimeSeconds:
                voiceInputMusicTimeRef.current ??
                playbackRef.current.currentTime,
            },
          ];
        }

        return previousMessages.map((message) =>
          message.id === pendingId
            ? { ...message, text: cleanText }
            : message,
        );
      });

      pendingVoiceHistoryMessageIdRef.current = null;
    },
    [],
  );

  const addUserTextMessage = useCallback(
    (text: string, musicTimeSeconds: number) => {
      const message: ListeningMessage = {
        id: createMessageId(),
        sender: "user",
        text,
        musicTimeSeconds,
      };
      listeningMessagesRef.current = [
        ...listeningMessagesRef.current,
        message,
      ];
      setListeningMessages(listeningMessagesRef.current);
    },
    [],
  );

  const connectQwenRealtime = useCallback(() => {
    if (qwenClientRef.current) {
      return qwenClientRef.current;
    }

    setQwenRealtimeError("");
    setQwenRealtimeStatus("connecting");
    qwenReadyRef.current = false;

    const shouldPlayCurrentReplyAudio = () => {
      if (communicationModeRef.current === "text") return false;
      const promptKind = activeQwenPromptKindRef.current;
      if (!promptKind) return false;
      if (promptKind === "user_reply") return true;

      return listeningInputModeRef.current === "file"
        ? playbackRef.current.isPlaying
        : liveListeningStatusRef.current === "listening" &&
            hasRecentSustainedLiveAudio();
    };

    const client = new QwenRealtimeClient({
      onStatusChange: (status) => {
        if (qwenClientRef.current !== client) return;
        setQwenRealtimeStatus(status);

        if (status === "configured") {
          qwenReadyRef.current = true;
          setQwenMomentStatus("connected");
          setQwenRealtimeError("");
          if (!waitingForQwenResponseRef.current) {
            setCompanionReplyStatus("idle");
            setCompanionReplyError("");
          }
        }

        if (status === "error") {
          qwenReadyRef.current = false;
          setQwenMomentStatus("error");
        }

        if (status === "closed") {
          qwenReadyRef.current = false;
          qwenClientRef.current = null;
          waitingForQwenResponseRef.current = false;
          activeQwenPromptKindRef.current = null;
          qwenResponseMusicTimeRef.current = null;
          clearQwenResponseWatchdog();
          setIsSendingText(false);
          setQwenMomentStatus("error");
          setCompanionReplyStatus("error");
          setCompanionReplyError(
            "Realtime 连接已断开，请重新发送或继续播放以重连。",
          );
        }
      },

      onTextDelta: () => {},

      onTextDone: (text) => {
        const inputMode = listeningInputModeRef.current;
        const isLiveListening =
          inputMode !== "file" &&
          liveListeningStatusRef.current === "listening";

        if (
          !waitingForQwenResponseRef.current &&
          !isLiveListening
        ) {
          console.warn(
            "[MusicCompanion] Ignored Qwen text.done without an active outbound prompt",
            text,
          );
          return;
        }

        if (
          activeQwenPromptKindRef.current ===
            "proactive_comment" &&
          ((inputMode === "file" &&
            !playbackRef.current.isPlaying) ||
            (inputMode !== "file" &&
              !hasRecentSustainedLiveAudio()))
        ) {
          waitingForQwenResponseRef.current = false;
          activeQwenPromptKindRef.current = null;
          qwenResponseMusicTimeRef.current = null;
          return;
        }

        addCompanionMessage(
          text,
          "qwen-realtime",
          qwenResponseMusicTimeRef.current ??
            (isLiveListening
              ? Math.max(
                  0,
                  (Date.now() -
                    liveListeningStartedAtRef.current) /
                    1000,
                )
              : playbackRef.current.currentTime),
        );
        qwenResponseMusicTimeRef.current = null;
      },

      onInputTranscriptDone: (text, inputKind) => {
        if (inputKind === "voice") {
          updatePendingVoiceHistoryMessage(text);
        }
      },

      onInputTranscriptFailed: (inputKind) => {
        if (inputKind === "voice") {
          updatePendingVoiceHistoryMessage(
            "未能识别这段录音",
          );
        }
      },

      onAudioStart: () => {
        if (shouldPlayCurrentReplyAudio()) {
          beginReplyAudio();
        }
      },

      onAudioDelta: (audioBase64) => {
        if (shouldPlayCurrentReplyAudio()) {
          appendReplyAudio(audioBase64);
        }
      },

      onAudioDone: () => {
        if (shouldPlayCurrentReplyAudio()) {
          finishReplyAudio();
        }
      },

      onResponseDone: () => {
        clearQwenResponseWatchdog();
        setIsSendingText(false);
        waitingForQwenResponseRef.current = false;
        activeQwenPromptKindRef.current = null;
        qwenResponseMusicTimeRef.current = null;
        setCompanionReplyStatus("idle");
        setQwenMomentStatus("connected");
      },

      onError: (message) => {
        if (qwenClientRef.current !== client) return;
        clearQwenResponseWatchdog();
        setIsSendingText(false);
        setQwenRealtimeError(message);
        setCompanionReplyStatus("error");
        setCompanionReplyError(message);
        qwenReadyRef.current = false;
        qwenClientRef.current = null;
        client.disconnect();
        waitingForQwenResponseRef.current = false;
        activeQwenPromptKindRef.current = null;
        qwenResponseMusicTimeRef.current = null;
        setQwenMomentStatus("error");
      },

    });

    qwenClientRef.current = client;
    client.connect();

    return client;
  }, [
    addCompanionMessage,
    appendReplyAudio,
    beginReplyAudio,
    clearQwenResponseWatchdog,
    finishReplyAudio,
    hasRecentSustainedLiveAudio,
    updatePendingVoiceHistoryMessage,
  ]);

  useEffect(() => {
    connectQwenRealtime();
  }, [connectQwenRealtime]);

  useEffect(() => {
    const restoreRealtimeConnection = () => {
      if (
        document.visibilityState === "hidden" ||
        !navigator.onLine ||
        !hasActiveListeningInput ||
        qwenClientRef.current?.isReady()
      ) {
        return;
      }

      const staleClient = qwenClientRef.current;
      qwenClientRef.current = null;
      qwenReadyRef.current = false;
      staleClient?.disconnect();
      lastQwenReconnectMsRef.current = 0;
      connectQwenRealtime();
    };

    window.addEventListener("online", restoreRealtimeConnection);
    window.addEventListener("pageshow", restoreRealtimeConnection);
    document.addEventListener(
      "visibilitychange",
      restoreRealtimeConnection,
    );

    return () => {
      window.removeEventListener("online", restoreRealtimeConnection);
      window.removeEventListener("pageshow", restoreRealtimeConnection);
      document.removeEventListener(
        "visibilitychange",
        restoreRealtimeConnection,
      );
    };
  }, [connectQwenRealtime, hasActiveListeningInput]);

  const sendPromptToQwen = useCallback(
    async ({
      prompt,
      kind,
    }: PendingQwenPrompt) => {
      const isListeningNow =
        listeningInputMode === "file"
          ? Boolean(audioFile) &&
            playbackRef.current.isPlaying &&
            !playbackRef.current.isSeeking
          : liveListeningStatus === "listening" &&
            hasRecentSustainedLiveAudio();
      if (
        kind === "proactive_comment" &&
        (!isListeningNow ||
          waitingForQwenResponseRef.current ||
          replyAudioPlayingRef.current)
      ) {
        return false;
      }

      const client = connectQwenRealtime();

      setCompanionReplyStatus("thinking");
      setCompanionReplyError("");
      setQwenRealtimeError("");

      try {
        const isReady =
          client.isReady() || (await client.waitUntilReady());
        if (!isReady) {
          throw new Error("Realtime 连接超时，请重试。");
        }

        if (voiceTurnActiveRef.current || !isListeningNow) {
          return false;
        }

        const liveMusicTimeSeconds =
          listeningInputMode === "file"
            ? playbackRef.current.currentTime
            : Math.max(
                0,
                (Date.now() - liveListeningStartedAtRef.current) /
                  1000,
              );

        const receivedAudioSeconds =
          client.getPendingMusicDurationSeconds();
        if (
          kind === "proactive_comment" &&
          receivedAudioSeconds < MIN_PROACTIVE_AUDIO_SECONDS
        ) {
          setCompanionReplyStatus("idle");
          setQwenMomentStatus("connected");
          return false;
        }
        const evidenceAwarePrompt = [
          prompt,
          `本轮实际附带约 ${receivedAudioSeconds.toFixed(1)} 秒连续歌曲音频；必须检查完整音频，尤其是后半段是否已经进入演唱。`,
        ].join("\n");

        waitingForQwenResponseRef.current = true;
        activeQwenPromptKindRef.current = kind;
        qwenResponseMusicTimeRef.current = liveMusicTimeSeconds;

        if (
          !client.commitMusicStream(
            evidenceAwarePrompt,
            communicationModeRef.current === "voice",
          )
        ) {
          waitingForQwenResponseRef.current = false;
          activeQwenPromptKindRef.current = null;
          qwenResponseMusicTimeRef.current = null;
          setCompanionReplyStatus("idle");
          setQwenMomentStatus("connected");
          return false;
        }

        qwenRequestIdRef.current += 1;
        startQwenResponseWatchdog(
          client,
          qwenRequestIdRef.current,
        );
        if (kind === "proactive_comment") {
          hasRequestedProactiveCommentRef.current = true;
          lastRealtimeCommentSecondRef.current = Math.floor(
            liveMusicTimeSeconds,
          );
        }
        lastQwenPromptSentMsRef.current = Date.now();
        console.info("[MusicCompanion] Qwen prompt sent", {
          requestId: qwenRequestIdRef.current,
          kind,
          musicTimeSeconds: liveMusicTimeSeconds,
          inputMode: "live_stream",
          promptPreview: prompt.slice(0, 120),
        });

        setCompanionReplyStatus("streaming");
        setQwenMomentStatus("commenting");
        return true;
      } catch (error) {
        waitingForQwenResponseRef.current = false;
        activeQwenPromptKindRef.current = null;
        qwenResponseMusicTimeRef.current = null;
        const message =
          error instanceof Error
            ? error.message
            : "无法把歌曲发送给 AI。";
        setCompanionReplyStatus("error");
        setCompanionReplyError(message);
        setQwenMomentStatus("error");
        return false;
      }
    },
    [
      audioFile,
      connectQwenRealtime,
      hasRecentSustainedLiveAudio,
      listeningInputMode,
      liveListeningStatus,
      startQwenResponseWatchdog,
    ],
  );

  const schedulePromptToQwen = useCallback(
    ({
      prompt,
      kind,
      musicTimeSeconds,
      minimumDelayMs = 0,
      replaceScheduled = true,
    }: {
      prompt: string;
      kind: QwenPromptKind;
      musicTimeSeconds: number;
      minimumDelayMs?: number;
      replaceScheduled?: boolean;
    }) => {
      const isListeningNow =
        listeningInputMode === "file"
          ? Boolean(audioFile) &&
            playbackRef.current.isPlaying &&
            !playbackRef.current.isSeeking
          : liveListeningStatus === "listening" &&
            hasRecentSustainedLiveAudio();
      if (kind === "proactive_comment" && !isListeningNow) {
        return false;
      }

      if (
        scheduledQwenPromptTimeoutRef.current &&
        !replaceScheduled
      ) {
        return false;
      }

      if (scheduledQwenPromptTimeoutRef.current) {
        clearTimeout(scheduledQwenPromptTimeoutRef.current);
        scheduledQwenPromptTimeoutRef.current = null;
        scheduledQwenPromptKindRef.current = null;
      }

      const now = Date.now();
      const cooldownDelayMs = Math.max(
        0,
        QWEN_COMMENT_COOLDOWN_MS -
          (now - lastQwenPromptSentMsRef.current),
        QWEN_POST_SPEECH_COOLDOWN_MS -
          (now - lastReplyAudioFinishedMsRef.current),
      );
      const delayMs = Math.max(
        minimumDelayMs,
        cooldownDelayMs,
      );

      setCompanionReplyStatus("thinking");
      setCompanionReplyError("");
      setQwenRealtimeError("");
      setQwenMomentStatus("commenting");

      scheduledQwenPromptTimeoutRef.current = setTimeout(() => {
        scheduledQwenPromptTimeoutRef.current = null;
        scheduledQwenPromptKindRef.current = null;

        const isStillListening =
          listeningInputMode === "file"
              ? Boolean(audioFile) &&
                playbackRef.current.isPlaying &&
                !playbackRef.current.isSeeking
              : liveListeningStatus === "listening" &&
                hasRecentSustainedLiveAudio();

        if (
          kind === "proactive_comment" &&
          (!isStillListening ||
            voiceTurnActiveRef.current ||
            waitingForQwenResponseRef.current ||
            replyAudioPlayingRef.current)
        ) {
          setCompanionReplyStatus("idle");
          setQwenMomentStatus(
            qwenReadyRef.current ? "connected" : "idle",
          );
          return;
        }

        const livePlayback = playbackRef.current;
        const liveMusicTimeSeconds =
          kind === "proactive_comment"
            ? listeningInputMode === "file"
              ? livePlayback.currentTime
              : Math.max(
                  0,
                  (Date.now() - liveListeningStartedAtRef.current) /
                    1000,
                )
            : musicTimeSeconds;
        const promptPlayback: PlaybackSnapshot =
          listeningInputMode === "file"
            ? livePlayback
            : {
                currentTime: liveMusicTimeSeconds,
                duration: 0,
                isPlaying: true,
                isSeeking: false,
              };
        const livePrompt =
          kind === "proactive_comment"
            ? buildQwenPrompt({
                kind,
                audioFile,
                listeningSource: listeningInputMode,
                playback: promptPlayback,
                messages: listeningMessagesRef.current,
                localAudioFeatures:
                  listeningInputMode === "file"
                    ? localAudioFeatures
                    : null,
                isRevisitedSegment:
                  revisitedUntilSecondRef.current > 0 &&
                  Math.floor(livePlayback.currentTime) <=
                    revisitedUntilSecondRef.current,
              })
            : prompt;

        void sendPromptToQwen({
          prompt: livePrompt,
          musicTimeSeconds: liveMusicTimeSeconds,
          kind,
        });
      }, delayMs);
      scheduledQwenPromptKindRef.current = kind;

      return true;
    },
    [
      audioFile,
      hasRecentSustainedLiveAudio,
      listeningInputMode,
      liveListeningStatus,
      localAudioFeatures,
      sendPromptToQwen,
    ],
  );

  const cancelScheduledProactiveComment =
    useCallback(() => {
      if (
        scheduledQwenPromptTimeoutRef.current &&
        scheduledQwenPromptKindRef.current ===
          "proactive_comment"
      ) {
        clearTimeout(scheduledQwenPromptTimeoutRef.current);
        scheduledQwenPromptTimeoutRef.current = null;
        scheduledQwenPromptKindRef.current = null;
        setQwenMomentStatus("connected");
      }
    }, []);

  const cancelActiveProactiveComment = useCallback(() => {
    if (
      activeQwenPromptKindRef.current !== "proactive_comment"
    ) {
      return;
    }

    const client = qwenClientRef.current;
    qwenClientRef.current = null;
    qwenReadyRef.current = false;
    client?.disconnect();
    clearQwenResponseWatchdog();
    waitingForQwenResponseRef.current = false;
    activeQwenPromptKindRef.current = null;
    qwenResponseMusicTimeRef.current = null;
    stopReplyAudio();
    setCompanionReplyStatus("idle");
    setQwenMomentStatus(
      qwenReadyRef.current ? "connected" : "idle",
    );
    setQwenRealtimeStatus("closed");
  }, [clearQwenResponseWatchdog, stopReplyAudio]);

  useEffect(() => {
    if (
      listeningInputMode !== "file" ||
      playback.isPlaying ||
      voiceTurnActiveRef.current
    ) {
      return;
    }

    cancelScheduledProactiveComment();
    cancelActiveProactiveComment();
    qwenClientRef.current?.clearInputAudio();
  }, [
    cancelActiveProactiveComment,
    cancelScheduledProactiveComment,
    listeningInputMode,
    playback.isPlaying,
  ]);

  const resetListeningSession = useCallback(() => {
    if (scheduledQwenPromptTimeoutRef.current) {
      clearTimeout(scheduledQwenPromptTimeoutRef.current);
      scheduledQwenPromptTimeoutRef.current = null;
      scheduledQwenPromptKindRef.current = null;
    }
    clearQwenResponseWatchdog();
    clearVoiceResponseWatchdog();

    setPlayback(INITIAL_PLAYBACK);
    setListeningMessages([]);
    setCompanionReplyStatus("idle");
    setCompanionReplyError("");
    setQwenRealtimeError("");
    setAudioFileError("");
    setQwenMomentStatus("idle");
    setIsSendingVoice(false);
    setIsSendingText(false);
    setVoiceInputError("");
    stopReplyAudio();
    void stopRealtimeMicrophone();
    void stopLiveListening();
    qwenVoiceClientRef.current?.disconnect();
    qwenVoiceClientRef.current = null;
    voiceCallActiveRef.current = false;
    voiceRecordingActiveRef.current = false;
    voiceResponseActiveRef.current = false;
    setIsVoiceCallConnected(false);
    liveListeningStartedAtRef.current = 0;
    resetLocalAudioFeatures();

    lastRealtimeCommentSecondRef.current = 0;
    hasRequestedProactiveCommentRef.current = false;
    previousPlaybackSecondRef.current = 0;
    furthestPlaybackSecondRef.current = 0;
    revisitedUntilSecondRef.current = 0;
    lastQwenPromptSentMsRef.current = 0;
    lastReplyAudioFinishedMsRef.current = 0;
    replyAudioPlayingRef.current = false;
    waitingForQwenResponseRef.current = false;
    activeQwenPromptKindRef.current = null;
    qwenResponseMusicTimeRef.current = null;
    voiceInputMusicTimeRef.current = null;
    pendingVoiceHistoryMessageIdRef.current = null;
    voiceTurnActiveRef.current = false;
    liveAudibleStartedAtRef.current = 0;
    liveLastAudibleAtRef.current = 0;
  }, [
    resetLocalAudioFeatures,
    clearQwenResponseWatchdog,
    clearVoiceResponseWatchdog,
    stopLiveListening,
    stopRealtimeMicrophone,
    stopReplyAudio,
  ]);

  const transcodeAudioFile = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("/api/audio/transcode", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      let message = "音频转码失败。";

      try {
        const body =
          (await response.json()) as {
            error?: string;
          };

        message = body.error || message;
      } catch {}

      throw new Error(message);
    }

    const blob = await response.blob();

    return new File(
      [blob],
      createTranscodedFileName(file.name),
      {
        type: "audio/wav",
        lastModified: Date.now(),
      },
    );
  };

  const handleFileSelect = async (file: File) => {
    if (!isSupportedAudioFile(file)) {
      setAudioFileError(
        `暂不支持这个格式，请选择 ${getAcceptedAudioDescription()}。`,
      );
      return;
    }

    resetListeningSession();
    setListeningInputMode("file");

    const shouldTranscode =
      getFileExtension(file.name) === ".m4a" &&
      canUseServerAudioTranscode();

    setIsPreparingAudio(shouldTranscode);

    let playableFile = file;

    try {
      if (shouldTranscode) {
        setAudioFileError(
          "正在把这个 m4a 转成浏览器更稳定支持的 WAV 音频…",
        );
        playableFile = await transcodeAudioFile(file);
      }

      setAudioFile(playableFile);
      setAudioFileError("");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "音频转码失败。";

      setAudioFile(null);
      setAudioFileError(
        `这个 m4a 当前无法转成可播放音频：${message}`,
      );
      return;
    } finally {
      setIsPreparingAudio(false);
    }

    void analyzeLocalAudioFeatures(playableFile).catch((error) => {
      console.warn("本地听感分析失败：", error);
    });
  };

  useEffect(() => {
    const shouldConnect =
      listeningInputMode === "file"
        ? Boolean(audioFile) &&
          playback.isPlaying &&
          !playback.isSeeking
        : liveListeningStatus === "listening";
    if (!shouldConnect) {
      cancelScheduledProactiveComment();
      return;
    }

    if (voiceTurnActiveRef.current) {
      cancelScheduledProactiveComment();
      return;
    }

    if (
      qwenReadyRef.current ||
      qwenRealtimeStatus === "connecting"
    ) {
      return;
    }

    const now = Date.now();

    if (now - lastQwenReconnectMsRef.current < 10000) {
      return;
    }

    lastQwenReconnectMsRef.current = now;
    connectQwenRealtime();
  }, [
    audioFile,
    cancelScheduledProactiveComment,
    connectQwenRealtime,
    listeningInputMode,
    liveListeningStatus,
    playback.isPlaying,
    playback.isSeeking,
    qwenRealtimeStatus,
  ]);

  useEffect(() => {
    if (!audioFile || listeningInputMode !== "file") {
      return;
    }

    const currentSecond = Math.floor(playback.currentTime);
    const previousSecond =
      previousPlaybackSecondRef.current;
    const furthestSecond =
      furthestPlaybackSecondRef.current;
    const didRewind =
      previousSecond - currentSecond >= 3;

    if (didRewind) {
      cancelScheduledProactiveComment();
      revisitedUntilSecondRef.current = Math.max(
        revisitedUntilSecondRef.current,
        furthestSecond,
        previousSecond,
      );
      lastRealtimeCommentSecondRef.current = Math.max(
        0,
        currentSecond - PROACTIVE_COMMENT_INTERVAL_SECONDS,
      );
    }

    if (currentSecond > furthestSecond) {
      furthestPlaybackSecondRef.current = currentSecond;
    }

    previousPlaybackSecondRef.current = currentSecond;

    if (!playback.isPlaying || playback.isSeeking) {
      cancelScheduledProactiveComment();
      return;
    }

    if (voiceTurnActiveRef.current) {
      cancelScheduledProactiveComment();
      return;
    }

    const earliestCommentSecond =
      getEarliestProactiveCommentSecond(
        localAudioFeatures,
      );

    if (currentSecond < earliestCommentSecond) {
      cancelScheduledProactiveComment();
      return;
    }

    const isFirstProactiveComment =
      !hasRequestedProactiveCommentRef.current;
    if (
      !isAudibleAroundCurrentTime(
        localAudioFeatures,
        currentSecond,
      )
    ) {
      cancelScheduledProactiveComment();
      return;
    }

    const isRevisitedSegment =
      revisitedUntilSecondRef.current > 0 &&
      currentSecond <= revisitedUntilSecondRef.current;

    if (
      !isFirstProactiveComment &&
      currentSecond - lastRealtimeCommentSecondRef.current <
        PROACTIVE_COMMENT_INTERVAL_SECONDS
    ) {
      return;
    }

    schedulePromptToQwen({
      prompt: buildQwenPrompt({
        kind: "proactive_comment",
        audioFile,
        listeningSource: "file",
        playback,
        messages: listeningMessagesRef.current,
        localAudioFeatures,
        isRevisitedSegment,
      }),
      kind: "proactive_comment",
      musicTimeSeconds: playback.currentTime,
      replaceScheduled: false,
    });
  }, [
    audioFile,
    playback,
    playback.currentTime,
    playback.isPlaying,
    playback.isSeeking,
    cancelScheduledProactiveComment,
    schedulePromptToQwen,
    localAudioFeatures,
    listeningInputMode,
  ]);

  const startVoiceCall = useCallback(async () => {
    if (communicationModeRef.current !== "voice") return false;
    if (!hasActiveListeningInput) return false;
    if (voiceRecordingActiveRef.current) return false;

    if (voiceResponseActiveRef.current) {
      clearVoiceResponseWatchdog();
      const previousVoiceClient = qwenVoiceClientRef.current;
      qwenVoiceClientRef.current = null;
      previousVoiceClient?.disconnect();
      voiceCallActiveRef.current = false;
      voiceResponseActiveRef.current = false;
      voiceTurnActiveRef.current = false;
      setIsVoiceCallConnected(false);
      setIsSendingVoice(false);
      stopReplyAudio();
    }

    setVoiceInputError("");
    void prepareReplyAudio();

    voiceTurnActiveRef.current = true;
    voiceRecordingActiveRef.current = true;
    voiceInputMusicTimeRef.current =
      listeningInputMode === "file"
        ? playbackRef.current.currentTime
        : Math.max(
            0,
            (Date.now() - liveListeningStartedAtRef.current) / 1000,
          );
    cancelScheduledProactiveComment();
    if (
      listeningInputMode === "file" &&
      playbackRef.current.isPlaying
    ) {
      musicPlayerRef.current?.pauseForVoiceRecording();
    }

    if (waitingForQwenResponseRef.current) {
      const musicClient = qwenClientRef.current;
      qwenClientRef.current = null;
      qwenReadyRef.current = false;
      musicClient?.disconnect();
      clearQwenResponseWatchdog();
      waitingForQwenResponseRef.current = false;
      activeQwenPromptKindRef.current = null;
      qwenResponseMusicTimeRef.current = null;
    }
    stopReplyAudio();

    let client = qwenVoiceClientRef.current;
    if (client?.isReady()) {
      try {
        await startRealtimeMicrophone();
        return true;
      } catch {
        voiceRecordingActiveRef.current = false;
        voiceTurnActiveRef.current = false;
        musicPlayerRef.current?.resumeAfterVoiceRecording();
        return false;
      }
    }
    if (client) {
      voiceRecordingActiveRef.current = false;
      voiceTurnActiveRef.current = false;
      musicPlayerRef.current?.resumeAfterVoiceRecording();
      return false;
    }

    client = new QwenRealtimeClient({
      onStatusChange: (status) => {
        if (
          status !== "closed" ||
          qwenVoiceClientRef.current !== client
        ) {
          return;
        }
        clearVoiceResponseWatchdog();
        qwenVoiceClientRef.current = null;
        voiceCallActiveRef.current = false;
        voiceRecordingActiveRef.current = false;
        voiceResponseActiveRef.current = false;
        voiceTurnActiveRef.current = false;
        setIsVoiceCallConnected(false);
        setIsSendingVoice(false);
        setVoiceInputError("语音连接已断开，请点击麦克风重新连接。");
        void stopRealtimeMicrophone();
        musicPlayerRef.current?.resumeAfterVoiceRecording();
      },

      onInputTranscriptDone: (text) => {
        updatePendingVoiceHistoryMessage(text);
      },

      onInputTranscriptFailed: () => {
        updatePendingVoiceHistoryMessage("未能识别这段语音");
      },

      onTextDone: (text) => {
        addCompanionMessage(
          text,
          "qwen-voice-call",
          voiceInputMusicTimeRef.current ??
            playbackRef.current.currentTime,
        );
      },

      onAudioStart: beginReplyAudio,
      onAudioDelta: appendReplyAudio,
      onAudioDone: finishReplyAudio,

      onResponseDone: () => {
        clearVoiceResponseWatchdog();
        setIsSendingVoice(false);
        voiceResponseActiveRef.current = false;
        voiceTurnActiveRef.current = false;
        setCompanionReplyStatus("idle");
        setQwenMomentStatus(
          qwenReadyRef.current ? "connected" : "idle",
        );
      },

      onError: (message) => {
        if (qwenVoiceClientRef.current !== client) return;
        clearVoiceResponseWatchdog();
        qwenVoiceClientRef.current = null;
        voiceCallActiveRef.current = false;
        voiceRecordingActiveRef.current = false;
        voiceResponseActiveRef.current = false;
        setIsVoiceCallConnected(false);
        voiceTurnActiveRef.current = false;
        setIsSendingVoice(false);
        setVoiceInputError(message);
        setCompanionReplyStatus("error");
        setCompanionReplyError(message);
        void stopRealtimeMicrophone();
        musicPlayerRef.current?.resumeAfterVoiceRecording();
      },

    });

    qwenVoiceClientRef.current = client;
    client.connect();

    try {
      if (!(await client.waitUntilReady())) {
        throw new Error("语音通话连接超时，请重试。");
      }

      const instructions = buildQwenPrompt({
        kind: "user_reply",
        audioFile,
        listeningSource: listeningInputMode,
        playback: playbackRef.current,
        messages: listeningMessagesRef.current,
        localAudioFeatures,
        userText:
          "这是持续语音通话。快速、自然地回答用户刚说的话；用户仍在听歌，不要要求暂停音乐。歌曲内容参考另一条持续聆听链路积累的上下文。",
        isRevisitedSegment:
          revisitedUntilSecondRef.current > 0 &&
          Math.floor(playbackRef.current.currentTime) <=
            revisitedUntilSecondRef.current,
      });

      if (!client.startVoiceCall(instructions)) {
        throw new Error("无法启动语音通话。");
      }
      if (!(await client.waitUntilReady())) {
        throw new Error("语音通话配置超时，请重试。");
      }

      voiceCallActiveRef.current = true;
      await startRealtimeMicrophone();
      setIsVoiceCallConnected(true);
      return true;
    } catch (unknownError) {
      if (qwenVoiceClientRef.current === client) {
        qwenVoiceClientRef.current = null;
      }
      voiceCallActiveRef.current = false;
      voiceRecordingActiveRef.current = false;
      voiceResponseActiveRef.current = false;
      voiceTurnActiveRef.current = false;
      setIsVoiceCallConnected(false);
      client.disconnect();
      musicPlayerRef.current?.resumeAfterVoiceRecording();
      const message =
        unknownError instanceof Error
          ? unknownError.message
          : "无法开始语音通话。";
      setVoiceInputError(message);
      return false;
    }
  }, [
    addCompanionMessage,
    appendReplyAudio,
    audioFile,
    beginReplyAudio,
    cancelScheduledProactiveComment,
    clearQwenResponseWatchdog,
    clearVoiceResponseWatchdog,
    finishReplyAudio,
    hasActiveListeningInput,
    listeningInputMode,
    localAudioFeatures,
    prepareReplyAudio,
    startRealtimeMicrophone,
    stopRealtimeMicrophone,
    stopReplyAudio,
    updatePendingVoiceHistoryMessage,
  ]);

  const handleListeningInputChange = async (
    nextMode: ListeningInputMode,
  ) => {
    cancelScheduledProactiveComment();
    cancelActiveProactiveComment();
    qwenClientRef.current?.clearInputAudio();
    liveAudibleStartedAtRef.current = 0;
    liveLastAudibleAtRef.current = 0;
    setListeningInputMode(nextMode);

    if (nextMode === "file") {
      await stopLiveListening();
      return;
    }

    if (
      nextMode === listeningInputMode &&
      liveListeningStatus === "listening"
    ) {
      return;
    }

    void prepareReplyAudio();
    connectQwenRealtime();
    try {
      await startLiveListening(
        nextMode === "local_speaker"
          ? "system_audio"
          : "microphone",
        nextMode === "nearby_speaker" && isMicrophoneMuted,
      );
    } catch {
      // 采集 hook 已提供可直接显示的错误信息。
    }
  };

  useEffect(() => {
    if (
      listeningInputMode === "file" ||
      liveListeningStatus !== "listening"
    ) {
      return;
    }

    const requestComment = () => {
      const now = Date.now();
      if (!hasRecentSustainedLiveAudio()) {
        return;
      }

      if (
        now - liveAudibleStartedAtRef.current <
        LIVE_FIRST_COMMENT_DELAY_MS
      ) {
        return;
      }

      const elapsedSeconds = Math.max(
        0,
        (now - liveListeningStartedAtRef.current) / 1000,
      );
      if (
        hasRequestedProactiveCommentRef.current &&
        elapsedSeconds - lastRealtimeCommentSecondRef.current <
          PROACTIVE_COMMENT_INTERVAL_SECONDS
      ) {
        return;
      }
      const livePlayback: PlaybackSnapshot = {
        currentTime: elapsedSeconds,
        duration: 0,
        isPlaying: true,
        isSeeking: false,
      };
      schedulePromptToQwen({
        prompt: buildQwenPrompt({
          kind: "proactive_comment",
          audioFile: null,
          listeningSource: listeningInputMode,
          playback: livePlayback,
          messages: listeningMessagesRef.current,
          localAudioFeatures: null,
        }),
        kind: "proactive_comment",
        musicTimeSeconds: elapsedSeconds,
        replaceScheduled: false,
      });
    };

    const commentInterval = setInterval(requestComment, 1000);
    return () => {
      clearInterval(commentInterval);
    };
  }, [
    hasRecentSustainedLiveAudio,
    listeningInputMode,
    liveListeningStatus,
    schedulePromptToQwen,
  ]);

  const handleToggleMicrophone = () => {
    const nextMuted = !isMicrophoneMuted;
    setMicrophoneMuted(nextMuted);
    if (listeningInputMode === "nearby_speaker") {
      setListeningMicrophoneMuted(nextMuted);
    }
    if (nextMuted) {
      cancelScheduledProactiveComment();
      cancelActiveProactiveComment();
      if (listeningInputMode === "nearby_speaker") {
        qwenClientRef.current?.clearInputAudio();
      }
      qwenVoiceClientRef.current?.clearInputAudio();
    }
  };

  const handleToggleSpeaker = () => {
    if (isSpeakerMuted) {
      const restoredVolume = Math.max(
        0.05,
        lastAiReplyVolumeRef.current,
      );
      setAiReplyVolume(restoredVolume);
      setIsSpeakerMuted(false);
      return;
    }
    if (aiReplyVolume > 0) {
      lastAiReplyVolumeRef.current = aiReplyVolume;
    }
    setAiReplyVolume(0);
    setIsSpeakerMuted(true);
  };

  const handleAiVolumeChange = (volume: number) => {
    setAiReplyVolume(volume);
    setIsSpeakerMuted(volume === 0);
    if (volume > 0) lastAiReplyVolumeRef.current = volume;
  };

  const handleHangUp = async () => {
    clearVoiceResponseWatchdog();
    qwenVoiceClientRef.current?.disconnect();
    qwenVoiceClientRef.current = null;
    voiceCallActiveRef.current = false;
    voiceRecordingActiveRef.current = false;
    voiceResponseActiveRef.current = false;
    voiceTurnActiveRef.current = false;
    setIsVoiceCallConnected(false);
    setIsSendingVoice(false);
    setCompanionReplyStatus("idle");
    await stopRealtimeMicrophone();
    musicPlayerRef.current?.resumeAfterVoiceRecording();
  };

  const handleCommunicationModeChange = (
    nextMode: CommunicationMode,
  ) => {
    if (nextMode === communicationMode) return;

    communicationModeRef.current = nextMode;
    setCommunicationMode(nextMode);
    setVoiceInputError("");
    stopReplyAudio();

    if (nextMode === "text") {
      qwenVoiceClientRef.current?.disconnect();
      qwenVoiceClientRef.current = null;
      voiceCallActiveRef.current = false;
      voiceRecordingActiveRef.current = false;
      voiceResponseActiveRef.current = false;
      voiceTurnActiveRef.current = false;
      setIsVoiceCallConnected(false);
      setIsSendingVoice(false);
      clearVoiceResponseWatchdog();
      void stopRealtimeMicrophone();
      musicPlayerRef.current?.resumeAfterVoiceRecording();
    }
  };

  const handleSendText = async (text: string) => {
    const cleanText = text.trim();
    if (!cleanText || !hasActiveListeningInput || isSendingText) {
      return false;
    }

    cancelScheduledProactiveComment();
    cancelActiveProactiveComment();
    stopReplyAudio();
    setIsSendingText(true);
    setCompanionReplyStatus("thinking");
    setCompanionReplyError("");
    setQwenRealtimeError("");

    const musicTimeSeconds =
      listeningInputMode === "file"
        ? playbackRef.current.currentTime
        : Math.max(
            0,
            (Date.now() - liveListeningStartedAtRef.current) / 1000,
          );
    const promptPlayback: PlaybackSnapshot =
      listeningInputMode === "file"
        ? playbackRef.current
        : {
            currentTime: musicTimeSeconds,
            duration: 0,
            isPlaying: true,
            isSeeking: false,
          };

    addUserTextMessage(cleanText, musicTimeSeconds);

    try {
      const client = connectQwenRealtime();
      if (!(client.isReady() || (await client.waitUntilReady()))) {
        throw new Error("Realtime 连接超时，请重试。");
      }

      const pendingMusicSeconds =
        client.getPendingMusicDurationSeconds();
      const shouldAttachCurrentMusic = pendingMusicSeconds >= 0.25;
      const instructions = [
        buildQwenPrompt({
          kind: "user_reply",
          audioFile,
          listeningSource: listeningInputMode,
          playback: promptPlayback,
          messages: listeningMessagesRef.current,
          localAudioFeatures:
            listeningInputMode === "file"
              ? localAudioFeatures
              : null,
          userText: cleanText,
          textOnlyReply: true,
        }),
        shouldAttachCurrentMusic
          ? `本轮在用户文字之前附带了约 ${pendingMusicSeconds.toFixed(1)} 秒截至当前尚未分析的歌曲原音。用户若询问歌词或声音内容，必须以这段音频为第一手证据直接回答。`
          : "本轮没有可提交的新歌曲音频；只能依据已有对话回答，不得假装刚刚又听到了新的歌词或声音。",
      ].join("\n");

      waitingForQwenResponseRef.current = true;
      activeQwenPromptKindRef.current = "user_reply";
      qwenResponseMusicTimeRef.current = musicTimeSeconds;
      if (!client.sendTextMessage(
        cleanText,
        instructions,
        false,
        shouldAttachCurrentMusic,
      )) {
        throw new Error("无法发送文字消息。");
      }
      qwenRequestIdRef.current += 1;
      startQwenResponseWatchdog(
        client,
        qwenRequestIdRef.current,
      );

      setCompanionReplyStatus("streaming");
      setQwenMomentStatus("commenting");
      return true;
    } catch (error) {
      waitingForQwenResponseRef.current = false;
      activeQwenPromptKindRef.current = null;
      qwenResponseMusicTimeRef.current = null;
      setIsSendingText(false);
      const message =
        error instanceof Error ? error.message : "无法发送文字消息。";
      setCompanionReplyStatus("error");
      setCompanionReplyError(message);
      return false;
    }
  };

  const handleVoiceStart = async () => {
    return startVoiceCall();
  };

  const handleVoiceStop = async () => {
    await stopRealtimeMicrophone();
    voiceRecordingActiveRef.current = false;
    musicPlayerRef.current?.resumeAfterVoiceRecording();
    const client = qwenVoiceClientRef.current;
    if (!voiceTurnActiveRef.current || !client) return;

    if (!client.commitVoiceTurn()) {
      voiceResponseActiveRef.current = false;
      voiceTurnActiveRef.current = false;
      setVoiceInputError("没有录到有效语音，请点击麦克风再说一次。");
      return;
    }
    if (!pendingVoiceHistoryMessageIdRef.current) {
      addPendingVoiceHistoryMessage();
    }

    setIsSendingVoice(true);
    voiceResponseActiveRef.current = true;
    setCompanionReplyStatus("thinking");
    setQwenMomentStatus("commenting");
    clearVoiceResponseWatchdog();
    voiceResponseTimeoutRef.current = setTimeout(() => {
      voiceResponseTimeoutRef.current = null;
      if (qwenVoiceClientRef.current === client) {
        qwenVoiceClientRef.current = null;
      }
      client.disconnect();
      voiceCallActiveRef.current = false;
      voiceRecordingActiveRef.current = false;
      voiceResponseActiveRef.current = false;
      voiceTurnActiveRef.current = false;
      setIsVoiceCallConnected(false);
      setIsSendingVoice(false);
      setCompanionReplyStatus("error");
      setCompanionReplyError(
        "语音回复中断，连接已自动重置，请点击麦克风重试。",
      );
      setVoiceInputError("语音回复超时，已重置连接。");
    }, QWEN_RESPONSE_DEADLINE_MS);
  };

  return (
    <main className="app-shell">
      <div
        className="
          background-orb
          background-orb-blue
        "
        aria-hidden="true"
      />

      <div
        className="
          background-orb
          background-orb-purple
        "
        aria-hidden="true"
      />

      <section style={styles.container}>
        <header style={styles.header}>
          <div style={styles.brandBadge}>
            <span
              style={styles.brandDot}
              aria-hidden="true"
            />

            MusicCompanion
          </div>

          <h1 style={styles.title}>有人和你一起听</h1>

          <p style={styles.subtitle}>
            音乐发生的时候，也有人听见。
          </p>
        </header>

        <section style={styles.heroCard}>
          <p style={styles.description}>
            {!audioFile
              ? isPreparingAudio
                ? "正在准备这个音频文件，稍等一下。"
                : "选择一首音乐，AI会陪你聊它的听感、情绪和变化。"
              : localFeatureStatus === "analyzing"
                ? "正在理解这首歌的听感，不影响你直接播放。"
                : "音乐已准备好。你可以直接播放，千问会按播放时间主动短评。"}
          </p>

          <AudioUploader
            disabled={isPreparingAudio}
            onFileSelect={handleFileSelect}
          />

          <div className="listening-source-control">
            <p className="listening-source-label">AI 听音乐的方式</p>
            <div className="listening-source-options" role="group" aria-label="选择 AI 的音乐输入来源">
              {(
                [
                  ["file", "上传音乐", "页面内播放"],
                  ["local_speaker", "系统声音", "直接获取本机音频"],
                  ["nearby_speaker", "其他设备", "手机·音箱·收音机"],
                ] as const
              ).map(([mode, label, detail]) => (
                <button
                  key={mode}
                  type="button"
                  className={`listening-source-button${listeningInputMode === mode ? " listening-source-button-active" : ""}`}
                  aria-pressed={listeningInputMode === mode}
                  onClick={() => void handleListeningInputChange(mode)}
                >
                  <span className="listening-source-button-title">{label}</span>
                  <span className="listening-source-button-detail">{detail}</span>
                </button>
              ))}
            </div>
            <p className="listening-source-help" aria-live="polite">
              {listeningInputMode === "file"
                ? audioFile
                  ? `AI 正在听页面内的 ${audioFile.name}`
                  : "上传音乐后，AI 会跟随页面播放器一起听。"
                : liveListeningStatus === "listening"
                  ? `正在通过 ${liveListeningLabel} 听${
                      listeningInputMode === "local_speaker"
                        ? "这台电脑的系统音乐"
                        : "其他设备外放的音乐"
                    }。`
                  : liveListeningStatus === "requesting_permission"
                    ? listeningInputMode === "local_speaker"
                      ? "正在请求系统音频共享…"
                      : "正在连接麦克风…"
                    : listeningInputMode === "local_speaker"
                      ? "选择正在播放音乐的标签页或屏幕，并勾选“共享音频”。不会使用摄像头。"
                      : "用手机、音箱或收音机外放音乐，AI 会通过麦克风和你一起听。"}
            </p>
            {listeningInputMode === "local_speaker" &&
              liveListeningCompatibilityNotice && (
                <p className="listening-source-help" role="status">
                  {liveListeningCompatibilityNotice}
                </p>
              )}
            {listeningInputMode !== "file" && liveListeningError && (
              <p className="voice-record-error" role="alert">
                {liveListeningError}
              </p>
            )}
          </div>

          {audioFileError && (
            <p style={styles.uploadError}>
              {audioFileError}
            </p>
          )}
        </section>

        <section style={styles.realtimeCard}>
          <div style={styles.realtimeHeader}>
            <div>
              <p style={styles.realtimeLabel}>
                Qwen-Omni-Realtime
              </p>

              <p style={styles.realtimeStatus}>
                {getRealtimeStatusText(qwenRealtimeStatus)}
              </p>
            </div>

          </div>

          <p style={styles.realtimeHint}>
            {getQwenMomentStatusText(qwenMomentStatus)}
          </p>

          {qwenRealtimeError && (
            <p style={styles.realtimeError}>
              {qwenRealtimeError}
            </p>
          )}

          {hasActiveListeningInput && (
            <button
              type="button"
              style={styles.manualRealtimeButton}
              disabled={
                listeningInputMode === "file" &&
                (!playback.isPlaying || playback.isSeeking)
              }
              onClick={() => {
                const isFileInput = listeningInputMode === "file";
                if (isFileInput && !audioFile) {
                  return;
                }
                const elapsedSeconds = isFileInput
                  ? playbackRef.current.currentTime
                  : Math.max(
                      0,
                      (Date.now() - liveListeningStartedAtRef.current) /
                        1000,
                    );
                const currentPlayback = isFileInput
                  ? playbackRef.current
                  : {
                      currentTime: elapsedSeconds,
                      duration: 0,
                      isPlaying: true,
                      isSeeking: false,
                    };

                schedulePromptToQwen({
                  prompt: buildQwenPrompt({
                    kind: "proactive_comment",
                    audioFile,
                    listeningSource: listeningInputMode,
                    playback: currentPlayback,
                    messages: listeningMessagesRef.current,
                    localAudioFeatures: isFileInput
                      ? localAudioFeatures
                      : null,
                  }),
                  kind: "proactive_comment",
                  musicTimeSeconds: elapsedSeconds,
                  replaceScheduled: false,
                });
              }}
            >
              请求千问短评
            </button>
          )}
        </section>

        <MusicPlayer
          key={`player-${trackKey}`}
          audioFile={audioFile}
          playerRef={musicPlayerRef}
          onPlaybackStateChange={handlePlaybackStateChange}
          onPlaybackAudioChunk={handlePlaybackAudioChunk}
          onPlaybackIntent={() => {
            void prepareReplyAudio();
            connectQwenRealtime();
          }}
          suspendForVoiceRecording={
            listeningInputMode === "file" &&
            (voiceRecorderStatus === "requesting_permission" ||
              voiceRecorderStatus === "recording")
          }
        />

        <ListeningHistory messages={listeningMessages} />

        {hasActiveListeningInput && (
          <div
            style={styles.companionReplyStatus}
            aria-live="polite"
          >
            {companionReplyStatus === "thinking"
              ? "正在连接千问并发送 messages…"
              : companionReplyStatus === "streaming"
                ? "千问正在回复中…"
                : companionReplyStatus === "error"
                  ? companionReplyError
                  : "你发的话会连同最近 messages 一起发给千问 Realtime。"}
          </div>
        )}

        <UserReplyBox
          key={`reply-box-${trackKey}`}
          disabled={!hasActiveListeningInput}
          status={
            isPlayingReply
              ? "speaking"
              : isSendingVoice
                ? "sending"
                : voiceRecorderStatus
          }
          error={voiceInputError || voiceRecorderError}
          inputDeviceLabel={inputDeviceLabel}
          isMicrophoneMuted={isMicrophoneMuted}
          musicContinuesWhenMicrophoneMuted={
            listeningInputMode !== "nearby_speaker"
          }
          isSpeakerMuted={isSpeakerMuted}
          isCallConnected={isVoiceCallConnected}
          isPlayingReply={isPlayingReply}
          aiVolume={aiReplyVolume}
          communicationMode={communicationMode}
          isTextSending={isSendingText}
          onStartRecording={handleVoiceStart}
          onStopRecording={handleVoiceStop}
          onToggleMicrophone={handleToggleMicrophone}
          onToggleSpeaker={handleToggleSpeaker}
          onHangUp={handleHangUp}
          onStopReply={stopReplyAudio}
          onAiVolumeChange={handleAiVolumeChange}
          onCommunicationModeChange={handleCommunicationModeChange}
          onSendText={handleSendText}
        />

        <footer style={styles.footer}>
          AI 可以听页面音乐、系统声音或其他设备外放；通话麦克风可随时关闭。
        </footer>
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  container: {
    position: "relative",
    zIndex: 1,
    width: "100%",
    maxWidth: "640px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "24px",
  },

  header: {
    width: "100%",
    padding: "20px 10px 8px",
    textAlign: "center",
  },

  brandBadge: {
    width: "fit-content",
    margin: "0 auto 22px",
    padding: "7px 13px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    border: "1px solid rgba(113, 137, 180, 0.18)",
    borderRadius: "999px",
    background: "rgba(255, 255, 255, 0.68)",
    boxShadow: "0 8px 28px rgba(54, 89, 142, 0.08)",
    backdropFilter: "blur(16px)",
    color: "var(--text-secondary)",
    fontSize: "12px",
    fontWeight: 400,
    letterSpacing: "0.04em",
  },

  brandDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    background: "linear-gradient(135deg, #5d8cff, #a47aff)",
    boxShadow: "0 0 14px rgba(93, 140, 255, 0.65)",
  },

  title: {
    margin: "0 0 12px",
    color: "var(--text-primary)",
    fontSize: "clamp(34px, 7vw, 52px)",
    fontWeight: 400,
    lineHeight: 1.12,
    letterSpacing: "-0.045em",
  },

  subtitle: {
    margin: 0,
    color: "var(--text-secondary)",
    fontSize: "15px",
    lineHeight: 1.7,
  },

  heroCard: {
    width: "100%",
    maxWidth: "520px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "18px",
    padding: "22px",
    border: "1px solid rgba(116, 139, 181, 0.16)",
    borderRadius: "24px",
    background: "rgba(255, 255, 255, 0.64)",
    boxShadow: "0 18px 60px rgba(74, 107, 163, 0.1)",
    backdropFilter: "blur(22px)",
  },

  description: {
    minHeight: "21px",
    margin: 0,
    color: "var(--text-secondary)",
    fontSize: "14px",
    lineHeight: 1.7,
    textAlign: "center",
  },

  uploadError: {
    maxWidth: "440px",
    margin: "-4px 0 0",
    color: "#c2410c",
    fontSize: "12px",
    lineHeight: 1.6,
    textAlign: "center",
  },

  realtimeCard: {
    width: "100%",
    maxWidth: "520px",
    padding: "16px",
    border: "1px solid rgba(116, 139, 181, 0.14)",
    borderRadius: "20px",
    background: "rgba(255, 255, 255, 0.56)",
    boxShadow: "0 14px 42px rgba(74, 107, 163, 0.08)",
    backdropFilter: "blur(18px)",
  },

  realtimeHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
  },

  realtimeLabel: {
    margin: "0 0 4px",
    color: "var(--text-tertiary)",
    fontSize: "11px",
    letterSpacing: "0.04em",
  },

  realtimeStatus: {
    margin: 0,
    color: "var(--text-secondary)",
    fontSize: "13px",
    lineHeight: 1.5,
  },

  realtimeButtons: {
    display: "flex",
    gap: "8px",
    flexShrink: 0,
  },

  realtimeButton: {
    border: "1px solid rgba(116, 139, 181, 0.18)",
    borderRadius: "999px",
    padding: "7px 11px",
    background: "rgba(255, 255, 255, 0.7)",
    color: "var(--text-secondary)",
    fontSize: "12px",
    cursor: "pointer",
  },

  realtimeHint: {
    margin: "12px 0 0",
    color: "var(--text-tertiary)",
    fontSize: "11px",
    lineHeight: 1.7,
  },

  realtimeError: {
    margin: "10px 0 0",
    color: "#c2410c",
    fontSize: "12px",
    lineHeight: 1.6,
  },

  manualRealtimeButton: {
    marginTop: "12px",
    border: "1px solid rgba(93, 140, 255, 0.24)",
    borderRadius: "999px",
    padding: "8px 13px",
    background: "rgba(93, 140, 255, 0.1)",
    color: "var(--text-secondary)",
    fontSize: "12px",
    cursor: "pointer",
  },

  companionReplyStatus: {
    width: "100%",
    maxWidth: "520px",
    marginTop: "-8px",
    padding: "10px 14px",
    border: "1px solid rgba(116, 139, 181, 0.14)",
    borderRadius: "16px",
    background: "rgba(255, 255, 255, 0.54)",
    color: "var(--text-tertiary)",
    fontSize: "12px",
    lineHeight: 1.6,
    textAlign: "center",
    boxShadow: "0 10px 34px rgba(74, 107, 163, 0.06)",
    backdropFilter: "blur(18px)",
  },

  demoButton: {
    border: "1px solid rgba(116, 139, 181, 0.18)",
    borderRadius: "999px",
    padding: "8px 14px",
    background: "rgba(255, 255, 255, 0.56)",
    color: "var(--text-secondary)",
    fontSize: "12px",
    cursor: "pointer",
  },

  footer: {
    maxWidth: "520px",
    padding: "8px 12px 18px",
    color: "var(--text-tertiary)",
    fontSize: "11px",
    lineHeight: 1.7,
    textAlign: "center",
  },
};

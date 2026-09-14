export type AppLanguage = "zh" | "en";

export function tr(
  language: AppLanguage,
  chinese: string,
  english: string,
) {
  return language === "en" ? english : chinese;
}

export function getAiReplyLanguageInstruction(
  language: AppLanguage,
) {
  return language === "en"
    ? "Output language: Reply entirely in natural English. Preserve quoted lyrics in their original language, but explain them in English. Never switch to Chinese unless the user explicitly asks you to."
    : "输出语言：始终使用自然中文回复。引用歌词时可以保留歌词原文，但解释必须使用中文；除非用户明确要求，否则不要切换成英文。";
}

const ENGLISH_RUNTIME_MESSAGES: Array<[
  RegExp,
  string | ((match: RegExpMatchArray) => string),
]> = [
  [/^千问 Realtime 未连接$/u, "Qwen Realtime is not connected"],
  [/^千问 Realtime 空闲$/u, "Qwen Realtime is idle"],
  [/^千问 Realtime 连接中$/u, "Connecting to Qwen Realtime"],
  [/^千问 Realtime 已连接$/u, "Qwen Realtime is connected"],
  [/^千问 Realtime 已准备好$/u, "Qwen Realtime is ready"],
  [/^千问 Realtime 正在响应$/u, "Qwen Realtime is responding"],
  [/^千问 Realtime 已断开$/u, "Qwen Realtime was disconnected"],
  [/^千问 Realtime 出错$/u, "Qwen Realtime encountered an error"],
  [/^系统声音$/u, "system audio"],
  [/^麦克风兼容模式$/u, "microphone compatibility mode"],
  [/^默认麦克风$/u, "Default microphone"],
  [/^正在识别…$/u, "Transcribing…"],
  [/^未识别到语音$/u, "No speech detected"],
  [/^语音通话连接超时，请重试。$/u, "Voice connection timed out. Please try again."],
  [/^千问 Realtime 还没有连接成功。$/u, "Qwen Realtime has not connected yet."],
  [/^千问 Realtime 连接错误。$/u, "Qwen Realtime connection error."],
  [/^请先选择音乐文件。$/u, "Please select a music file first."],
  [/^无法播放这个媒体文件。$/u, "This media file could not be played."],
  [/^当前浏览器不支持 Web Audio/u, "This browser does not support Web Audio."],
  [/^浏览器无法读取这个媒体文件的音轨。$/u, "The browser could not read the audio track in this file."],
  [/^没有读取到可播放的音轨时长。$/u, "No playable audio duration was found."],
  [/^音频解码失败。$/u, "Audio decoding failed."],
  [/^媒体音轨读取失败。$/u, "The media track could not be read."],
  [/^Realtime 连接超时，请重试。$/u, "Realtime connection timed out. Please try again."],
  [/^上一条回复还没有结束，请再点一次发送。$/u, "The previous response is still finishing. Tap send again."],
  [/^无法发送文字消息。$/u, "The text message could not be sent."],
  [/^没有录到有效语音，请点击麦克风再说一次。$/u, "No usable speech was recorded. Tap the microphone and try again."],
  [/^这次回复没有完整返回/u, "The response was incomplete. The connection was reset; please send it again."],
  [/^Realtime 响应中断/u, "The Realtime response was interrupted and the connection was reset."],
  [/^语音回复中断/u, "The voice response was interrupted. The connection was reset; tap the microphone to try again."],
  [/^语音回复超时/u, "The voice response timed out and the connection was reset."],
  [/^语音服务暂时繁忙$/u, "The voice service is temporarily busy."],
  [/^麦克风录音需要 localhost 或 HTTPS 页面。$/u, "Microphone recording requires localhost or an HTTPS page."],
  [/^当前环境没有提供麦克风接口。$/u, "Microphone access is unavailable in this environment."],
  [/^没有获得可用的麦克风音轨。$/u, "No usable microphone track was found."],
  [/^当前浏览器不支持实时音频处理。$/u, "This browser does not support real-time audio processing."],
  [/^实时声音采集需要 localhost 或 HTTPS 页面。$/u, "Live audio capture requires localhost or an HTTPS page."],
  [/^当前环境没有提供声音采集接口。$/u, "Audio capture is unavailable in this environment."],
  [/^暂不支持这个格式/u, "This audio format is not supported."],
  [/^正在把这个 m4a/u, "Converting this M4A file to WAV for more reliable browser playback…"],
  [/^音频转码失败。$/u, "Audio conversion failed."],
  [/^这个 m4a 当前无法转成可播放音频/u, "This M4A file could not be converted into playable audio."],
  [/^需要麦克风权限/u, "Microphone permission is required."],
  [/^无法访问麦克风/u, "The microphone could not be accessed."],
  [/^请允许麦克风权限/u, "Please allow microphone access and try again."],
  [/^请开始播放并确认共享了音频/u, "Start playback and make sure audio sharing is enabled."],
  [/^Safari暂不向网页提供系统声音/u, "Safari does not currently provide system audio to web pages. Use Chrome or Edge, or choose microphone compatibility mode."],
  [/^iPhone\/iPad 浏览器/u, "iPhone and iPad browsers cannot capture system audio directly. Use microphone compatibility mode."],
];

export function localizeRuntimeMessage(
  message: string,
  language: AppLanguage,
) {
  if (!message || language === "zh") return message;

  for (const [pattern, replacement] of ENGLISH_RUNTIME_MESSAGES) {
    const match = message.match(pattern);
    if (!match) continue;
    return typeof replacement === "function"
      ? replacement(match)
      : replacement;
  }

  return message;
}

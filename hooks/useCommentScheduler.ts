"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { DemoComment } from "@/types/music";

import {
  evaluatePlaybackWindow,
  getCommentIdsAtOrBefore,
  sortCommentsByTime,
} from "@/utils/commentScheduler";

interface UseCommentSchedulerOptions {
  comments: DemoComment[];
  currentTime: number;
  isPlaying: boolean;
  isSeeking: boolean;
  trackKey: string;

  onCommentTriggered?: (
    comment: DemoComment,
  ) => void;
}

interface UseCommentSchedulerResult {
  currentComment: DemoComment | null;
}

interface CurrentCommentState {
  trackKey: string;
  comment: DemoComment | null;
}

export function useCommentScheduler({
  comments,
  currentTime,
  isPlaying,
  isSeeking,
  trackKey,
  onCommentTriggered,
}: UseCommentSchedulerOptions): UseCommentSchedulerResult {
  const sortedComments = useMemo(
    () => sortCommentsByTime(comments),
    [comments],
  );

  /**
   * 把当前评论和所属歌曲放在一起保存。
   *
   * 换歌时，如果trackKey不同，
   * 旧评论会立即被视为空。
   */
  const [
    currentCommentState,
    setCurrentCommentState,
  ] = useState<CurrentCommentState>({
    trackKey,
    comment: null,
  });

  const currentComment =
    currentCommentState.trackKey === trackKey
      ? currentCommentState.comment
      : null;

  /**
   * 已经触发或已经被快进跳过的评论ID。
   */
  const triggeredIdsRef = useRef<Set<string>>(
    new Set(),
  );

  /**
   * 上一次播放器时间。
   */
  const previousTimeRef = useRef(0);

  /**
   * 用户开始拖动时的播放位置。
   */
  const seekStartTimeRef = useRef(0);

  /**
   * 上一次是否处于拖动状态。
   */
  const wasSeekingRef = useRef(false);

  /**
   * 保存最新的评论触发回调。
   *
   * 避免父组件重新渲染时，
   * 评论检测Effect重复运行。
   */
  const onCommentTriggeredRef = useRef(
    onCommentTriggered,
  );

  useEffect(() => {
    onCommentTriggeredRef.current =
      onCommentTriggered;
  }, [onCommentTriggered]);

  /**
   * 更换歌曲后重置评论调度状态。
   */
  useEffect(() => {
    triggeredIdsRef.current = new Set();
    previousTimeRef.current = 0;
    seekStartTimeRef.current = 0;
    wasSeekingRef.current = false;
  }, [trackKey]);

  /**
   * 处理用户拖动进度条。
   */
  useEffect(() => {
    /**
     * 刚开始拖动。
     */
    if (
      isSeeking &&
      !wasSeekingRef.current
    ) {
      seekStartTimeRef.current =
        previousTimeRef.current;

      wasSeekingRef.current = true;
      return;
    }

    /**
     * 刚结束拖动。
     */
    if (
      !isSeeking &&
      wasSeekingRef.current
    ) {
      const movedForward =
        currentTime >
        seekStartTimeRef.current + 0.5;

      /**
       * 向前拖动后，把当前位置之前的评论
       * 标记为已经错过。
       */
      if (movedForward) {
        const skippedIds =
          getCommentIdsAtOrBefore(
            sortedComments,
            currentTime,
          );

        for (const id of skippedIds) {
          triggeredIdsRef.current.add(id);
        }
      }

      previousTimeRef.current = currentTime;
      wasSeekingRef.current = false;
    }
  }, [
    currentTime,
    isSeeking,
    sortedComments,
  ]);

  /**
   * 正常播放时处理评论触发。
   */
  useEffect(() => {
    /**
     * 暂停或拖动时不触发评论。
     */
    if (
      !isPlaying ||
      isSeeking ||
      wasSeekingRef.current
    ) {
      previousTimeRef.current = currentTime;
      return;
    }

    const decision = evaluatePlaybackWindow({
      comments: sortedComments,

      triggeredIds:
        triggeredIdsRef.current,

      previousTime:
        previousTimeRef.current,

      currentTime,
    });

    /**
     * 无论是实际触发，还是快进跳过，
     * 都立即记录相应ID。
     */
    for (const id of decision.idsToMark) {
      triggeredIdsRef.current.add(id);
    }

    if (
      decision.type === "trigger" &&
      decision.comment
    ) {
      setCurrentCommentState({
        trackKey,
        comment: decision.comment,
      });

      onCommentTriggeredRef.current?.(
        decision.comment,
      );
    }

    previousTimeRef.current = currentTime;
  }, [
    currentTime,
    isPlaying,
    isSeeking,
    sortedComments,
    trackKey,
  ]);

  return {
    currentComment,
  };
}
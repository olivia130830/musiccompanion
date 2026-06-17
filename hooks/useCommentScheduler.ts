"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { DemoComment } from "@/types/music";

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

/**
 * 一次时间变化超过这个数值时，
 * 视为可能发生了快进，而不是正常连续播放。
 */
const MAX_CONTINUOUS_TIME_JUMP = 2.5;

export function useCommentScheduler({
  comments,
  currentTime,
  isPlaying,
  isSeeking,
  trackKey,
  onCommentTriggered,
}: UseCommentSchedulerOptions): UseCommentSchedulerResult {
  const sortedComments = useMemo(
    () =>
      [...comments].sort(
        (first, second) =>
          first.timeSeconds - second.timeSeconds,
      ),
    [comments],
  );

  /**
   * 当前评论和它所属的音乐标识放在一起保存。
   *
   * 换歌时不需要在Effect中同步调用setState，
   * 只要发现保存的trackKey和当前trackKey不同，
   * 就把currentComment视为null。
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
   * 已经触发过的评论ID。
   * 使用Ref避免React重新渲染时重复触发。
   */
  const triggeredIdsRef = useRef<Set<string>>(
    new Set(),
  );

  /**
   * 上一次记录的播放时间。
   */
  const previousTimeRef = useRef(0);

  /**
   * 开始拖动进度条时的位置。
   */
  const seekStartTimeRef = useRef(0);

  /**
   * 上一轮是否处于跳转状态。
   */
  const wasSeekingRef = useRef(false);

  /**
   * 保存最新的评论触发回调。
   * 避免父组件每次重新渲染时，
   * 让下面的评论检测Effect无意义地重新执行。
   */
  const onCommentTriggeredRef = useRef(
    onCommentTriggered,
  );

  useEffect(() => {
    onCommentTriggeredRef.current =
      onCommentTriggered;
  }, [onCommentTriggered]);

  /**
   * 更换音乐后重置内部调度数据。
   *
   * 这里不再调用setCurrentComment，
   * 避免React新版Lint报：
   * set-state-in-effect。
   */
  useEffect(() => {
    triggeredIdsRef.current = new Set();
    previousTimeRef.current = 0;
    seekStartTimeRef.current = 0;
    wasSeekingRef.current = false;
  }, [trackKey]);

  /**
   * 处理用户拖动或跳转播放进度。
   */
  useEffect(() => {
    /**
     * 用户刚开始拖动。
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
     * 用户刚结束拖动。
     */
    if (
      !isSeeking &&
      wasSeekingRef.current
    ) {
      const movedForward =
        currentTime >
        seekStartTimeRef.current + 0.5;

      /**
       * 如果向前快进，
       * 把当前位置之前的评论标记为已错过，
       * 但不显示，也不加入历史。
       */
      if (movedForward) {
        for (const comment of sortedComments) {
          if (
            comment.timeSeconds <= currentTime
          ) {
            triggeredIdsRef.current.add(
              comment.id,
            );
          }
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
   * 正常播放时检测是否经过评论时间点。
   */
  useEffect(() => {
    /**
     * 暂停、拖动时不触发评论。
     */
    if (
      !isPlaying ||
      isSeeking ||
      wasSeekingRef.current
    ) {
      previousTimeRef.current = currentTime;
      return;
    }

    const previousTime =
      previousTimeRef.current;

    const timeDifference =
      currentTime - previousTime;

    /**
     * 时间明显变小，说明用户倒退了。
     * 已出现的评论不清空，也不重复触发。
     */
    if (timeDifference < -0.5) {
      previousTimeRef.current = currentTime;
      return;
    }

    /**
     * 时间突然向前跳跃较大，
     * 说明可能发生了快进。
     *
     * 将被跳过的评论标记为已错过，
     * 但不显示、不加入历史。
     */
    if (
      timeDifference >
      MAX_CONTINUOUS_TIME_JUMP
    ) {
      for (const comment of sortedComments) {
        if (
          comment.timeSeconds <= currentTime
        ) {
          triggeredIdsRef.current.add(
            comment.id,
          );
        }
      }

      previousTimeRef.current = currentTime;
      return;
    }

    /**
     * 找出这次正常播放过程中，
     * 刚刚经过的第一条尚未触发的评论。
     *
     * 一次时间更新最多触发一条。
     */
    const nextComment = sortedComments.find(
      (comment) =>
        !triggeredIdsRef.current.has(
          comment.id,
        ) &&
        comment.timeSeconds > previousTime &&
        comment.timeSeconds <= currentTime,
    );

    if (nextComment) {
      /**
       * 必须先记录ID，再更新状态，
       * 避免React重新渲染导致重复触发。
       */
      triggeredIdsRef.current.add(
        nextComment.id,
      );

      setCurrentCommentState({
        trackKey,
        comment: nextComment,
      });

      onCommentTriggeredRef.current?.(
        nextComment,
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
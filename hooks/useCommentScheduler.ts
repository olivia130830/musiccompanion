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

/**
 * 一次播放时间变化超过这个数值时，
 * 视为可能发生了跳转，而不是正常连续播放。
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

  const [currentComment, setCurrentComment] =
    useState<DemoComment | null>(null);

  const triggeredIdsRef = useRef<Set<string>>(
    new Set(),
  );

  const previousTimeRef = useRef(0);
  const seekStartTimeRef = useRef(0);
  const wasSeekingRef = useRef(false);

  /**
   * 用Ref保存最新回调，避免父组件重新渲染时，
   * 评论检测Effect被无意义地重新执行。
   */
  const onCommentTriggeredRef = useRef(
    onCommentTriggered,
  );

  useEffect(() => {
    onCommentTriggeredRef.current =
      onCommentTriggered;
  }, [onCommentTriggered]);

  /**
   * 更换音乐时重置评论调度。
   */
  useEffect(() => {
    triggeredIdsRef.current = new Set();
    previousTimeRef.current = 0;
    seekStartTimeRef.current = 0;
    wasSeekingRef.current = false;
    setCurrentComment(null);
  }, [trackKey]);

  /**
   * 处理用户拖动或跳转播放进度。
   */
  useEffect(() => {
    if (isSeeking && !wasSeekingRef.current) {
      seekStartTimeRef.current =
        previousTimeRef.current;

      wasSeekingRef.current = true;
      return;
    }

    if (!isSeeking && wasSeekingRef.current) {
      const movedForward =
        currentTime >
        seekStartTimeRef.current + 0.5;

      /**
       * 向前跳转时，将当前位置之前的评论
       * 标记为已经错过，但不显示、不加入历史。
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
   * 正常播放时检测评论时间点。
   */
  useEffect(() => {
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
     * 时间变小，说明发生了倒退。
     * 已经触发的评论不清空、不重复。
     */
    if (timeDifference < -0.5) {
      previousTimeRef.current = currentTime;
      return;
    }

    /**
     * 时间突然向前变化较大，视为跳转。
     * 跳过中间评论，不批量补发。
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
     * 找出这次时间更新刚刚经过的第一条评论。
     * 一次更新最多触发一条。
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
       * 防止React重新渲染造成重复触发。
       */
      triggeredIdsRef.current.add(
        nextComment.id,
      );

      setCurrentComment(nextComment);

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
  ]);

  return {
    currentComment,
  };
}
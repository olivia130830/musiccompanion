"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DemoComment } from "@/types/music";

interface UseCommentSchedulerOptions {
  comments: DemoComment[];
  currentTime: number;
  isPlaying: boolean;
  isSeeking: boolean;
  trackKey: string;
}

interface UseCommentSchedulerResult {
  currentComment: DemoComment | null;
}

/**
 * 如果一次时间变化过大，就认为可能发生了快进，
 * 不补发被跳过的评论。
 */
const MAX_CONTINUOUS_TIME_JUMP = 2.5;

export function useCommentScheduler({
  comments,
  currentTime,
  isPlaying,
  isSeeking,
  trackKey,
}: UseCommentSchedulerOptions): UseCommentSchedulerResult {
  const sortedComments = useMemo(
    () => [...comments].sort((a, b) => a.timeSeconds - b.timeSeconds),
    [comments],
  );

  const [currentComment, setCurrentComment] =
    useState<DemoComment | null>(null);

  /**
   * 已经触发过的评论。
   * 使用Ref是为了防止React重复渲染造成重复触发。
   */
  const triggeredIdsRef = useRef<Set<string>>(new Set());

  /**
   * 上一次收到的播放时间。
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
   * 更换音乐后，重新开始评论调度。
   */
  useEffect(() => {
    triggeredIdsRef.current = new Set();
    previousTimeRef.current = 0;
    seekStartTimeRef.current = 0;
    wasSeekingRef.current = false;
    setCurrentComment(null);
  }, [trackKey]);

  /**
   * 专门处理进度条跳转。
   */
  useEffect(() => {
    /**
     * 用户刚开始拖动。
     */
    if (isSeeking && !wasSeekingRef.current) {
      seekStartTimeRef.current = previousTimeRef.current;
      wasSeekingRef.current = true;
      return;
    }

    /**
     * 用户刚结束拖动。
     */
    if (!isSeeking && wasSeekingRef.current) {
      const movedForward =
        currentTime > seekStartTimeRef.current + 0.5;

      /**
       * 如果向前快进，把当前位置之前的评论标记为已错过，
       * 但不把它们显示出来。
       */
      if (movedForward) {
        for (const comment of sortedComments) {
          if (comment.timeSeconds <= currentTime) {
            triggeredIdsRef.current.add(comment.id);
          }
        }
      }

      previousTimeRef.current = currentTime;
      wasSeekingRef.current = false;
    }
  }, [currentTime, isSeeking, sortedComments]);

  /**
   * 正常播放时检测是否经过评论时间点。
   */
  useEffect(() => {
    /**
     * 暂停、拖动时不触发评论。
     */
    if (!isPlaying || isSeeking || wasSeekingRef.current) {
      previousTimeRef.current = currentTime;
      return;
    }

    const previousTime = previousTimeRef.current;
    const timeDifference = currentTime - previousTime;

    /**
     * 时间明显变小，说明用户倒退了。
     * 已出现的评论不清空，也不重复。
     */
    if (timeDifference < -0.5) {
      previousTimeRef.current = currentTime;
      return;
    }

    /**
     * 时间突然向前跳跃，说明可能是快进。
     * 把跳过的评论标记为已错过，但不显示。
     */
    if (timeDifference > MAX_CONTINUOUS_TIME_JUMP) {
      for (const comment of sortedComments) {
        if (comment.timeSeconds <= currentTime) {
          triggeredIdsRef.current.add(comment.id);
        }
      }

      previousTimeRef.current = currentTime;
      return;
    }

    /**
     * 找出刚刚经过的第一条、且尚未出现的评论。
     * 一次时间更新最多出现一条。
     */
    const nextComment = sortedComments.find(
      (comment) =>
        !triggeredIdsRef.current.has(comment.id) &&
        comment.timeSeconds > previousTime &&
        comment.timeSeconds <= currentTime,
    );

    if (nextComment) {
      triggeredIdsRef.current.add(nextComment.id);
      setCurrentComment(nextComment);
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
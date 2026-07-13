import React from 'react';
import { Heart } from 'lucide-react';

export default function ReactionButton({
  count,
  disabled = false,
  reacted,
  requestTitle,
  onToggle,
}) {
  const safeCount = Number(count ?? 0);
  const label = reacted
    ? `取消心形：${requestTitle}，当前 ${safeCount}`
    : `点亮心形：${requestTitle}，当前 ${safeCount}`;

  return (
    <button
      type="button"
      className={`reaction-button${reacted ? ' is-active' : ''}`}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
    >
      <Heart
        aria-hidden="true"
        size={18}
        fill={reacted ? 'currentColor' : 'none'}
      />
      <span>{safeCount}</span>
    </button>
  );
}

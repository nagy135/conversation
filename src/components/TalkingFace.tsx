interface TalkingFaceProps {
  speaking: boolean;
  active: boolean;
}

/** Decorative avatar: speech is driven by the remote audio playback detector. */
export function TalkingFace({ speaking, active }: TalkingFaceProps) {
  return (
    <div className={`talking-face${active ? ' is-active' : ''}${speaking ? ' is-speaking' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 280 280" focusable="false">
        <circle className="face-halo" cx="140" cy="140" r="128" fill="#e9e9df" />
        <circle cx="140" cy="140" r="115" fill="#e0e5da" />
        <path d="M51 248c8-39 37-57 89-57s81 18 89 57a128 128 0 0 1-178 0" fill="#566b59" />
        <g className="face-head">
          <path d="M119 173h42v41c-10 12-32 12-42 0z" fill="#cc967b" />
          <ellipse cx="89" cy="135" rx="12" ry="19" fill="#dba88b" />
          <ellipse cx="191" cy="135" rx="12" ry="19" fill="#dba88b" />
          <path d="M86 110c0-43 22-65 54-65s54 22 54 65v33c0 35-25 60-54 60s-54-25-54-60z" fill="#eac0a0" />
          <path d="M85 126c-15-53 10-89 53-89 44 0 68 28 56 85l-10-29c-24 5-47-3-61-16-6 17-19 24-30 25z" fill="#41483a" />
          <path d="M101 115q11-7 23-1m32 0q12-6 23 1" fill="none" stroke="#665243" strokeWidth="4" strokeLinecap="round" />
          <g className="face-eyes" fill="#394136">
            <ellipse cx="113" cy="129" rx="4" ry="5" />
            <ellipse cx="167" cy="129" rx="4" ry="5" />
          </g>
          <path d="M139 132l-4 19q5 4 11 0" fill="none" stroke="#c88e72" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <ellipse cx="108" cy="152" rx="12" ry="6" fill="#d98d78" opacity=".25" />
          <ellipse cx="173" cy="152" rx="12" ry="6" fill="#d98d78" opacity=".25" />
          <path className="face-smile" d="M125 168q15 12 30 0" fill="none" stroke="#995e50" strokeWidth="3" strokeLinecap="round" />
          <g className="face-mouth">
            <ellipse cx="140" cy="171" rx="15" ry="11" fill="#713f38" />
            <path d="M128 165q12-5 24 0l-2 4h-20z" fill="#fff5e9" />
            <ellipse cx="140" cy="177" rx="8" ry="3" fill="#cd8477" />
          </g>
        </g>
      </svg>
    </div>
  );
}

import { formatDuration } from '../lib/format.js';

export const SPEEDS = [1, 5, 10, 30, 60, 120];

export default function Controls({ playing, fresh, onToggle, onRestart, speed, onSpeed, elapsed, duration, onSeek }) {
  const finished = elapsed >= duration;
  return (
    <div className="controls">
      <button className="btn primary" onClick={onToggle} aria-label={playing ? 'Pause' : finished ? (fresh ? 'Start' : 'Replay') : 'Play'}>
        {playing ? '❚❚ Pause' : finished ? (fresh ? '▶ Start' : '↺ Replay') : '▶ Play'}
      </button>
      <button className="btn" onClick={onRestart} aria-label="Restart" title="Back to start">
        ⏮
      </button>
      <div className="scrub">
        <input
          type="range"
          min="0"
          max={duration}
          step="100"
          value={Math.min(elapsed, duration)}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label="Position in run"
        />
        <span className="time">
          {formatDuration(elapsed)} / {formatDuration(duration)}
        </span>
      </div>
      <label className="speed">
        Speed
        <select value={speed} onChange={(e) => onSpeed(Number(e.target.value))}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

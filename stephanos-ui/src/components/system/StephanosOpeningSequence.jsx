import { useEffect, useRef, useState } from 'react';

const BOOT_MESSAGES = [
  'Initialising systems...',
  'Loading mission-control interfaces...',
  'Syncing local runtime truth...',
  'Stephanos launcher ready.',
];

const CHAR_DELAY_MS = 24;
const LINE_DELAY_MS = 320;
const COMPLETE_PAUSE_MS = 540;
const MAX_SEQUENCE_DURATION_MS = 20000;

export default function StephanosOpeningSequence({ onComplete }) {
  const [lines, setLines] = useState([]);
  const [isComplete, setIsComplete] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioAvailable, setAudioAvailable] = useState(true);

  const completedRef = useRef(false);
  const audioEnabledRef = useRef(false);

  const finishSequence = (fallbackTriggered = false) => {
    if (completedRef.current) {
      return;
    }

    completedRef.current = true;
    setIsComplete(true);

    if (fallbackTriggered && typeof onComplete === 'function') {
      onComplete();
    }
  };

  useEffect(() => {
    audioEnabledRef.current = audioEnabled;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timeoutIds = [];

    const sleep = (ms) => new Promise((resolve) => {
      const timeoutId = window.setTimeout(resolve, ms);
      timeoutIds.push(timeoutId);
    });

    const maybePlayTick = () => {
      if (!audioEnabledRef.current || cancelled) {
        return;
      }

      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.type = 'square';
        oscillator.frequency.value = 820;
        gainNode.gain.value = 0.0008;

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.02);
        window.setTimeout(() => {
          audioContext.close().catch(() => {});
        }, 30);
      } catch (error) {
        setAudioAvailable(false);
      }
    };

    const runSequence = async () => {
      for (const message of BOOT_MESSAGES) {
        if (cancelled) {
          return;
        }

        let line = '';
        for (const char of message) {
          if (cancelled) {
            return;
          }

          line += char;
          setLines((prev) => {
            const next = [...prev];
            next[next.length - 1] = line;
            return next;
          });
          maybePlayTick();
          await sleep(CHAR_DELAY_MS);
        }

        if (cancelled) {
          return;
        }

        setLines((prev) => [...prev, '']);
        await sleep(LINE_DELAY_MS);
      }

      await sleep(COMPLETE_PAUSE_MS);
      if (!cancelled) {
        finishSequence(false);
      }
    };

    setLines(['']);
    void runSequence();

    const fallbackTimeoutId = window.setTimeout(() => {
      if (!cancelled) {
        finishSequence(true);
      }
    }, MAX_SEQUENCE_DURATION_MS);
    timeoutIds.push(fallbackTimeoutId);

    return () => {
      cancelled = true;
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, []);

  return (
    <section className="stephanos-opening-sequence" role="status" aria-live="polite">
      <div className="stephanos-opening-sequence__terminal" aria-label="Stephanos opening sequence">
        {lines.filter((line) => line.length > 0).map((line, index) => (
          <p key={`${line}-${index}`} className="stephanos-opening-sequence__line">{line}</p>
        ))}
      </div>
      <div className="stephanos-opening-sequence__actions">
        <button
          type="button"
          className="ghost-button"
          onClick={() => setAudioEnabled((prev) => !prev)}
        >
          {audioEnabled ? 'Disable Audio Cues' : 'Enable Audio Cues'}
        </button>
        {!audioAvailable ? <span>Audio unavailable in this environment.</span> : null}
      </div>
      {isComplete ? (
        <div className="stephanos-opening-sequence__controls">
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              if (typeof onComplete === 'function') {
                onComplete();
              }
            }}
          >
            Continue to Landing
          </button>
        </div>
      ) : null}
    </section>
  );
}

let context: AudioContext | undefined;

export function primeAlarm(): void {
  if (typeof AudioContext === 'undefined') return;
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume().catch(() => {});
  } catch {
    // Audio is optional; a failed context must not interrupt reading.
  }
}

export function playChime(): void {
  const audio = context;
  if (!audio || audio.state !== 'running') return;
  const now = audio.currentTime;
  [660, 880].forEach((frequency, index) => {
    const start = now + index * 0.16;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.06, start + 0.02);
    gain.gain.linearRampToValueAtTime(0, start + 0.14);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.15);
  });
}

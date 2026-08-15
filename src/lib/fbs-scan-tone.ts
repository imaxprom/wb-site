"use client";

export function playFbsScanTone(success: boolean) {
  if (success) return;
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(650, context.currentTime);
    oscillator.frequency.setValueAtTime(420, context.currentTime + 0.3);
    gain.gain.setValueAtTime(0.95, context.currentTime);
    gain.gain.setValueAtTime(0.95, context.currentTime + 0.5);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.7);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.7);
    oscillator.addEventListener("ended", () => void context.close(), { once: true });
  } catch {
    // Visual feedback remains available if the browser blocks audio.
  }
}

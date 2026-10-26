// Detect a frozen source without mistaking a pause or hidden display for a stall.
export function createVideoHealth(timeout = 6000) {
  let lastTime = null;
  let movedAt = 0;
  let recovered = false;
  return {
    reset() { lastTime = null; movedAt = 0; recovered = false; },
    check(time, now, active) {
      if (!active) { lastTime = null; movedAt = now; return null; }
      if (lastTime === null || Math.abs(time - lastTime) > 0.08) { lastTime = time; movedAt = now; return null; }
      if (now - movedAt < timeout) return null;
      movedAt = now;
      if (!recovered) { recovered = true; return "recover"; }
      return "fallback";
    },
  };
}

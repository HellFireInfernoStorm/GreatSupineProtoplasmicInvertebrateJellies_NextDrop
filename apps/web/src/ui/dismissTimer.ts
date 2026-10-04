export function createDismissTimer(done: () => void, duration: number) {
  let remaining = Math.max(0, duration);
  let started = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  return {
    resume() {
      if (finished || timer !== undefined) return;
      started = Date.now();
      timer = setTimeout(() => {
        timer = undefined;
        finished = true;
        done();
      }, remaining);
    },
    pause() {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
      remaining = Math.max(0, remaining - (Date.now() - started));
    },
    dispose() {
      clearTimeout(timer);
      timer = undefined;
      finished = true;
    },
  };
}

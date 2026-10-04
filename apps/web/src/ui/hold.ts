export function createHoldController(done: () => void, duration = 1200) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active = false;
  let disposed = false;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    active = false;
  };
  return {
    start() {
      if (active || disposed) return;
      active = true;
      timer = setTimeout(() => {
        timer = undefined;
        if (!disposed && active) done();
      }, duration);
    },
    cancel,
    dispose() {
      cancel();
      disposed = true;
    },
  };
}

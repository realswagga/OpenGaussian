let transferLocked = false;
let activeMutations = 0;
const waiters = new Set<() => void>();

export function isTransferLocked() {
  return transferLocked;
}

export function beginMutation() {
  activeMutations += 1;
}

export function endMutation() {
  activeMutations = Math.max(0, activeMutations - 1);
  if (activeMutations === 0) {
    for (const resolve of waiters) resolve();
    waiters.clear();
  }
}

export async function acquireTransferBarrier(timeoutMs = 300_000) {
  if (transferLocked) throw new Error('Another project transfer is already running');
  transferLocked = true;
  if (activeMutations === 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(done);
      transferLocked = false;
      reject(new Error('Timed out waiting for active API mutations to finish'));
    }, timeoutMs);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    waiters.add(done);
  });
}

export function releaseTransferBarrier() {
  transferLocked = false;
}


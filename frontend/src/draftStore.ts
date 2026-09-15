const DEVICE_KEY = "dce.open-device-draft";
const CAPTURE_KEY = "dce.capture-draft";
const MAX_AGE_MS = 36 * 60 * 60 * 1000;

export type StoredDeviceDraft<T = unknown> = {
  projectId: number;
  deviceId: number | null;
  rackId: number | "" | null;
  path?: string;
  draft: T;
  savedAt: number;
};

export type StoredCaptureDraft<T = unknown> = {
  projectId: number;
  areaId: number | "";
  rowId: number | "";
  rackId: number | "";
  draft: T;
  savedAt: number;
};

function store(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function readJson<T>(key: string): T | null {
  try {
    const raw = store()?.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isFresh(savedAt: number) {
  return Number.isFinite(savedAt) && Date.now() - savedAt < MAX_AGE_MS;
}

export function writeOpenDeviceDraft<T>(entry: StoredDeviceDraft<T>) {
  try {
    store()?.setItem(DEVICE_KEY, JSON.stringify({ ...entry, savedAt: entry.savedAt || Date.now() }));
  } catch {
    /* private mode / quota */
  }
}

export function peekOpenDeviceDraft<T = unknown>(): StoredDeviceDraft<T> | null {
  const row = readJson<StoredDeviceDraft<T>>(DEVICE_KEY);
  if (!row || !isFresh(row.savedAt)) return null;
  return row;
}

export function readOpenDeviceDraft<T>(
  projectId: number,
  deviceId: number | null,
  rackId?: number | "" | null,
): StoredDeviceDraft<T> | null {
  const row = peekOpenDeviceDraft<T>();
  if (!row || row.projectId !== projectId) return null;
  if ((row.deviceId ?? null) !== (deviceId ?? null)) return null;
  if (
    deviceId == null &&
    rackId != null &&
    rackId !== "" &&
    row.rackId != null &&
    row.rackId !== "" &&
    row.rackId !== rackId
  ) {
    return null;
  }
  return row;
}

export function clearOpenDeviceDraft(projectId?: number, deviceId?: number | null) {
  const row = peekOpenDeviceDraft();
  if (!row) {
    store()?.removeItem(DEVICE_KEY);
    return;
  }
  if (projectId != null && row.projectId !== projectId) return;
  if (deviceId === undefined || row.deviceId == null || row.deviceId === deviceId) {
    store()?.removeItem(DEVICE_KEY);
  }
}

export function writeCaptureDraft<T>(entry: StoredCaptureDraft<T>) {
  try {
    store()?.setItem(CAPTURE_KEY, JSON.stringify({ ...entry, savedAt: entry.savedAt || Date.now() }));
  } catch {
    /* private mode / quota */
  }
}

export function readCaptureDraft<T>(projectId: number): StoredCaptureDraft<T> | null {
  const row = readJson<StoredCaptureDraft<T>>(CAPTURE_KEY);
  if (!row || row.projectId !== projectId || !isFresh(row.savedAt)) return null;
  return row;
}

export function clearCaptureDraft(projectId?: number) {
  const row = readJson<StoredCaptureDraft>(CAPTURE_KEY);
  if (projectId != null && row && row.projectId !== projectId) return;
  store()?.removeItem(CAPTURE_KEY);
}

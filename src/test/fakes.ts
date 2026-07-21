import { createDefaultSettings } from '../app/defaults';
import type { AppSettings, ActivityEvent, NotificationStatus } from '../app/model';
import type {
  AudioPort, Clock, ControllerDependencies, NotificationPort,
} from '../app/appController';
import type { NotificationPayload } from '../features/reminders/domain/presentation';
import type { StoredCodexPet } from '../features/pets/domain/types';
import type { HistoryRepository } from '../infrastructure/historyRepository';
import type { PetRepository } from '../infrastructure/petRepository';
import type { SettingsRepository } from '../infrastructure/settingsRepository';
import type { Locale } from '../i18n/types';

export class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(String(key), String(value));
  }
}

export class FakeClock implements Clock {
  constructor(private value: number) {}

  now(): number {
    return this.value;
  }

  set(value: number): void {
    this.value = value;
  }
}

export class FakeSettingsRepository implements SettingsRepository {
  readonly saves: AppSettings[] = [];
  cleared = false;

  constructor(
    public value: AppSettings | null,
    public saveFailure = false,
    public loadFailure = false,
    public clearFailure = false,
  ) {}

  async load(): Promise<AppSettings | null> {
    if (this.loadFailure) throw new Error('settings load failed');
    return this.value;
  }

  async save(value: AppSettings): Promise<void> {
    if (this.saveFailure) throw new Error('settings save failed');
    this.value = structuredClone(value);
    this.saves.push(structuredClone(value));
  }

  async clear(): Promise<void> {
    if (this.clearFailure) throw new Error('settings clear failed');
    this.cleared = true;
    this.value = null;
  }
}

export class FakeHistoryRepository implements HistoryRepository {
  readonly events: ActivityEvent[] = [];
  prunedAt: number[] = [];
  cleared = false;

  constructor(
    public appendFailure = false,
    public clearFailure = false,
  ) {}

  async append(value: ActivityEvent): Promise<void> {
    if (this.appendFailure) throw new Error('history append failed');
    this.events.push(value);
  }

  async listSince(timestamp: number): Promise<ActivityEvent[]> {
    return this.events.filter((event) => event.occurredAt >= timestamp);
  }

  async prune(now: number): Promise<void> {
    this.prunedAt.push(now);
  }

  async clear(): Promise<void> {
    if (this.clearFailure) throw new Error('history clear failed');
    this.cleared = true;
    this.events.length = 0;
  }
}

export class FakePetRepository implements PetRepository {
  readonly values = new Map<string, StoredCodexPet>();
  cleared = false;
  putFailure = false;
  deleteFailure = false;
  clearFailure = false;

  async list(): Promise<StoredCodexPet[]> {
    return [...this.values.values()]
      .map(clonePet)
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  async put(value: StoredCodexPet): Promise<void> {
    if (this.putFailure) throw new Error('pet put failed');
    this.values.set(value.id, clonePet(value));
  }

  async delete(id: string): Promise<void> {
    if (this.deleteFailure) throw new Error('pet delete failed');
    this.values.delete(id);
  }

  async clear(): Promise<void> {
    if (this.clearFailure) throw new Error('pet clear failed');
    this.cleared = true;
    this.values.clear();
  }
}

function clonePet(value: StoredCodexPet): StoredCodexPet {
  const { spritesheet, ...metadata } = value;
  return {
    ...structuredClone(metadata),
    spritesheet: spritesheet.slice(0, spritesheet.size, spritesheet.type),
  };
}

export class FakeNotifications implements NotificationPort {
  deliveries: NotificationPayload[] = [];
  requests = 0;

  constructor(
    public permission: NotificationStatus = 'default',
    public requestedPermission: NotificationStatus = 'granted',
  ) {}

  status(): NotificationStatus {
    return this.permission;
  }

  async request(): Promise<NotificationStatus> {
    this.requests += 1;
    this.permission = this.requestedPermission;
    return this.permission;
  }

  async notify(payload: NotificationPayload): Promise<void> {
    this.deliveries.push({ ...payload });
  }
}

export class FakeAudio implements AudioPort {
  plays = 0;

  async play(): Promise<void> {
    this.plays += 1;
  }
}

interface FakeDependencyOptions {
  now: number;
  settings?: AppSettings | null;
  historyFailure?: boolean;
  settingsFailure?: boolean;
  notificationStatus?: NotificationStatus;
  defaultLocale?: Locale;
}

export interface FakeDependencies extends ControllerDependencies {
  clock: FakeClock;
  settings: FakeSettingsRepository;
  history: FakeHistoryRepository;
  pets: FakePetRepository;
  notifications: FakeNotifications;
  audio: FakeAudio;
}

export function createFakeDependencies(options: FakeDependencyOptions): FakeDependencies {
  return {
    clock: new FakeClock(options.now),
    settings: new FakeSettingsRepository(
      options.settings === undefined ? createDefaultSettings(options.now) : options.settings,
      options.settingsFailure,
    ),
    history: new FakeHistoryRepository(options.historyFailure),
    pets: new FakePetRepository(),
    notifications: new FakeNotifications(options.notificationStatus),
    audio: new FakeAudio(),
    ...(options.defaultLocale === undefined ? {} : { defaultLocale: options.defaultLocale }),
  };
}

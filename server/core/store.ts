import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { assertSafeId, resolveInside } from "../security/paths.js";
import type { ActivityEntry, Mission, MissionListItem } from "./types.js";
import { isTerminal } from "./stateMachine.js";

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

const MAX_ACTIVITY = 600;

/**
 * Mission persistence: one JSON document per mission plus a files/ directory for
 * captures, screenshots and artifacts. Writes are atomic (tmp + rename).
 */
export class MissionStore {
  private missions = new Map<string, Mission>();
  readonly events = new EventEmitter();
  private pendingFlush = new Map<string, NodeJS.Timeout>();

  constructor(readonly root: string) {
    this.events.setMaxListeners(200);
    fs.mkdirSync(path.join(root, "missions"), { recursive: true });
    this.load();
  }

  private load(): void {
    const dir = path.join(this.root, "missions");
    for (const id of fs.readdirSync(dir)) {
      const file = path.join(dir, id, "mission.json");
      if (!fs.existsSync(file)) continue;
      try {
        const m = JSON.parse(fs.readFileSync(file, "utf8")) as Mission;
        if (!isTerminal(m.status) && m.status !== "awaiting_approval" && m.status !== "draft") {
          m.status = "failed";
          m.error = "Interrupted: the server restarted while this mission was in progress.";
        }
        this.missions.set(m.id, m);
      } catch {
        // A corrupt record is skipped rather than crashing the server.
      }
    }
  }

  missionDir(id: string): string {
    return path.join(this.root, "missions", assertSafeId(id));
  }

  filesDir(id: string): string {
    const d = path.join(this.missionDir(id), "files");
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  /** Resolve a file inside the mission's artifact directory, creating its parent directory. */
  filePath(id: string, relative: string): string {
    const full = resolveInside(this.filesDir(id), relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    return full;
  }

  create(m: Mission): Mission {
    this.missions.set(m.id, m);
    fs.mkdirSync(this.missionDir(m.id), { recursive: true });
    this.persistNow(m.id);
    return m;
  }

  get(id: string): Mission | undefined {
    return this.missions.get(id);
  }

  list(): MissionListItem[] {
    return [...this.missions.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((m) => ({
        id: m.id,
        prompt: m.prompt,
        status: m.status,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        artifactCount: m.artifacts.length,
        mode: m.mode,
        dataSource: m.dataSource,
      }));
  }

  /** Apply a mutation, persist (debounced) and notify subscribers. */
  update(id: string, fn: (m: Mission) => void): Mission {
    const m = this.missions.get(id);
    if (!m) throw new Error(`Unknown mission ${id}`);
    fn(m);
    m.updatedAt = nowIso();
    this.schedulePersist(id);
    this.events.emit(`mission:${id}`, m);
    this.events.emit("missions", m);
    return m;
  }

  log(id: string, entry: Omit<ActivityEntry, "id" | "at">): ActivityEntry {
    const full: ActivityEntry = { id: newId("act"), at: nowIso(), ...entry };
    this.update(id, (m) => {
      m.activity.push(full);
      if (m.activity.length > MAX_ACTIVITY) m.activity.splice(0, m.activity.length - MAX_ACTIVITY);
    });
    return full;
  }

  private schedulePersist(id: string): void {
    if (this.pendingFlush.has(id)) return;
    this.pendingFlush.set(
      id,
      setTimeout(() => {
        this.pendingFlush.delete(id);
        this.persistNow(id);
      }, 200),
    );
  }

  persistNow(id: string): void {
    const m = this.missions.get(id);
    if (!m) return;
    const file = path.join(this.missionDir(id), "mission.json");
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(m, null, 2));
    fs.renameSync(tmp, file);
  }

  flushAll(): void {
    for (const [id, t] of this.pendingFlush) {
      clearTimeout(t);
      this.persistNow(id);
    }
    this.pendingFlush.clear();
  }
}

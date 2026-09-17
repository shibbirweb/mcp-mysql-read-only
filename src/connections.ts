export interface ConnectionTarget {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface ConnectionProfile {
  name: string;
  origin: "env" | "session";
  target: ConnectionTarget;
}

const DEFAULT_HOST = "host.docker.internal";
const DEFAULT_PORT = 3306;

const profiles = new Map<string, ConnectionProfile>();

let activeName: string | null = null;
let activeTarget: ConnectionTarget | null = null;

export function describeTarget(target: ConnectionTarget): string {
  return `${target.user}@${target.host}:${target.port}/${target.database}`;
}

function buildTarget(raw: Record<string, unknown>, profileName: string): ConnectionTarget {
  const user = typeof raw.user === "string" ? raw.user : "";
  const database = typeof raw.database === "string" ? raw.database : "";

  if (!user) {
    throw new Error(`Profile "${profileName}" is missing "user".`);
  }
  if (!database) {
    throw new Error(`Profile "${profileName}" is missing "database".`);
  }

  return {
    host: typeof raw.host === "string" && raw.host ? raw.host : DEFAULT_HOST,
    port: typeof raw.port === "number" ? raw.port : DEFAULT_PORT,
    user,
    password: typeof raw.password === "string" ? raw.password : "",
    database,
  };
}

export function setActiveProfile(profileName: string): ConnectionTarget {
  const profile = profiles.get(profileName);
  if (!profile) {
    throw new Error(`Unknown profile "${profileName}".`);
  }
  activeName = profile.name;
  activeTarget = { ...profile.target };
  return activeTarget;
}

export function setActiveTarget(target: ConnectionTarget, profileName: string): ConnectionTarget {
  activeName = profileName;
  activeTarget = { ...target };
  return activeTarget;
}

function loadEnvProfiles(): void {
  const rawProfiles = process.env.MYSQL_PROFILES;

  if (rawProfiles) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawProfiles);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`[mcp-mysql-ro] MYSQL_PROFILES is not valid JSON, ignoring it: ${reason}`);
      parsed = null;
    }

    if (parsed && typeof parsed === "object") {
      for (const [profileName, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (!value || typeof value !== "object") {
          console.error(`[mcp-mysql-ro] Skipping profile "${profileName}": not an object.`);
          continue;
        }
        try {
          profiles.set(profileName, {
            name: profileName,
            origin: "env",
            target: buildTarget(value as Record<string, unknown>, profileName),
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          console.error(`[mcp-mysql-ro] Skipping profile "${profileName}": ${reason}`);
        }
      }
    }
  }

  const envUser = process.env.MYSQL_USER;
  const envDatabase = process.env.MYSQL_DATABASE;

  if (envUser && envDatabase && !profiles.has("default")) {
    profiles.set("default", {
      name: "default",
      origin: "env",
      target: {
        host: process.env.MYSQL_HOST ?? DEFAULT_HOST,
        port: parseInt(process.env.MYSQL_PORT ?? String(DEFAULT_PORT), 10),
        user: envUser,
        password: process.env.MYSQL_PASSWORD ?? "",
        database: envDatabase,
      },
    });
  }
}

function selectInitialProfile(): void {
  const preferred = process.env.MYSQL_DEFAULT_PROFILE;

  if (preferred && profiles.has(preferred)) {
    setActiveProfile(preferred);
    return;
  }
  if (preferred) {
    console.error(`[mcp-mysql-ro] MYSQL_DEFAULT_PROFILE="${preferred}" does not match any profile.`);
  }
  if (profiles.has("default")) {
    setActiveProfile("default");
    return;
  }

  const first = profiles.keys().next();
  if (!first.done) {
    setActiveProfile(first.value);
  }
}

loadEnvProfiles();
selectInitialProfile();

if (activeTarget) {
  console.error(`[mcp-mysql-ro] active connection: ${activeName} (${describeTarget(activeTarget)})`);
} else {
  console.error("[mcp-mysql-ro] no connection configured, call the connect tool to set one");
}

export function listProfiles(): ConnectionProfile[] {
  return Array.from(profiles.values());
}

export function getProfile(profileName: string): ConnectionProfile | undefined {
  return profiles.get(profileName);
}

export function addSessionProfile(profileName: string, target: ConnectionTarget): void {
  profiles.set(profileName, {
    name: profileName,
    origin: "session",
    target,
  });
}

export function getActiveTarget(): ConnectionTarget | null {
  return activeTarget;
}

export function getActiveName(): string | null {
  return activeName;
}

export function requireActiveTarget(): ConnectionTarget {
  if (!activeTarget) {
    throw new Error(
      "No active connection. Call connect with host/user/database, or use_connection with a profile name."
    );
  }
  return activeTarget;
}

export function withDatabase(target: ConnectionTarget, database: string): ConnectionTarget {
  return { ...target, database };
}

// Rôles au choix (niveau, domaines…), définis dans roles.json.
// Le fichier ne contient que des identifiants : noms et couleurs restent gérés sur Discord.

import { existsSync, readFileSync } from "node:fs";

export interface RoleOption {
  id: string;
  description?: string;
}

export interface RoleGroup {
  label: string;
  // Nombre maximum de rôles cochés dans ce groupe (1 = choix unique).
  max: number;
  roles: RoleOption[];
}

// Un message Discord contient au plus 5 rangées de composants, et un menu au plus 25 options.
export const MAX_GROUPS = 5;
export const MAX_ROLES_PER_GROUP = 25;

const SNOWFLAKE = /^\d{17,20}$/;

export function loadRoleGroups(path: string): RoleGroup[] {
  if (!existsSync(path)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path} n'est pas un JSON valide : ${(error as Error).message}`);
  }
  return parseRoleGroups(raw, path);
}

export function parseRoleGroups(raw: unknown, source = "roles.json"): RoleGroup[] {
  const fail = (message: string): never => {
    throw new Error(`${source} : ${message}`);
  };
  if (!Array.isArray(raw)) fail("le fichier doit contenir une liste de groupes `[ … ]`");

  const seen = new Set<string>();
  const groups: RoleGroup[] = [];

  (raw as unknown[]).forEach((entry, index) => {
    const where = `groupe n°${index + 1}`;
    if (typeof entry !== "object" || entry === null) fail(`${where} doit être un objet`);
    const { label, max, roles } = entry as Record<string, unknown>;

    if (typeof label !== "string" || !label.trim() || label.length > 100) {
      fail(`${where} : « label » doit être un texte de 1 à 100 caractères`);
    }
    if (!Array.isArray(roles)) fail(`${where} : « roles » doit être une liste`);
    if ((roles as unknown[]).length > MAX_ROLES_PER_GROUP) {
      fail(`${where} : ${MAX_ROLES_PER_GROUP} rôles au maximum par groupe`);
    }

    const options = (roles as unknown[]).map((role): RoleOption => {
      const option = typeof role === "string" ? { id: role } : (role as Record<string, unknown>);
      const { id, description } = option ?? {};
      if (typeof id !== "string" || !SNOWFLAKE.test(id)) {
        fail(`${where} : « ${String(id)} » n'est pas un identifiant de rôle (clic droit sur le rôle > Copier l'identifiant)`);
      }
      if (description !== undefined && (typeof description !== "string" || description.length > 100)) {
        fail(`${where} : la description du rôle ${String(id)} doit être un texte de 100 caractères au maximum`);
      }
      if (seen.has(id as string)) fail(`le rôle ${String(id)} apparaît plusieurs fois`);
      seen.add(id as string);
      return description ? { id: id as string, description: description as string } : { id: id as string };
    });

    if (max !== undefined && (!Number.isInteger(max) || (max as number) < 1)) {
      fail(`${where} : « max » doit être un entier supérieur ou égal à 1`);
    }

    // Un groupe sans rôle est ignoré : le fichier peut servir de modèle à compléter.
    if (options.length === 0) return;
    groups.push({
      label: (label as string).trim(),
      max: Math.min((max as number | undefined) ?? options.length, options.length),
      roles: options,
    });
  });

  if (groups.length > MAX_GROUPS) fail(`${MAX_GROUPS} groupes au maximum`);
  return groups;
}

export function managedRoleIds(groups: readonly RoleGroup[]): string[] {
  return groups.flatMap((group) => group.roles.map((role) => role.id));
}

// Rôles à ajouter et à retirer pour qu'un groupe corresponde exactement à la sélection.
// Les valeurs inconnues sont ignorées et la sélection est tronquée à `max`.
export function selectionChanges(
  group: RoleGroup,
  currentRoleIds: ReadonlySet<string>,
  selected: readonly string[],
): { add: string[]; remove: string[] } {
  const groupIds = group.roles.map((role) => role.id);
  const wanted = new Set(selected.filter((id) => groupIds.includes(id)).slice(0, group.max));
  return {
    add: groupIds.filter((id) => wanted.has(id) && !currentRoleIds.has(id)),
    remove: groupIds.filter((id) => !wanted.has(id) && currentRoleIds.has(id)),
  };
}

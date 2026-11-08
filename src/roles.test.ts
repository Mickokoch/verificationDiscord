import assert from "node:assert/strict";
import { test } from "node:test";
import { managedRoleIds, parseRoleGroups, selectionChanges } from "./roles.js";

const L1 = "100000000000000001";
const L2 = "100000000000000002";
const INFO = "100000000000000011";
const MATHS = "100000000000000012";
const GAMING = "100000000000000021";

test("lecture d'une configuration valide", () => {
  const groups = parseRoleGroups([
    { label: "Ton niveau", max: 1, roles: [L1, L2] },
    { label: "Domaines", roles: [INFO, MATHS] },
    { label: "Salons supplémentaires", roles: [{ id: GAMING, description: "Jeux vidéo" }] },
  ]);
  assert.deepEqual(groups, [
    { label: "Ton niveau", max: 1, roles: [{ id: L1 }, { id: L2 }] },
    { label: "Domaines", max: 2, roles: [{ id: INFO }, { id: MATHS }] },
    { label: "Salons supplémentaires", max: 1, roles: [{ id: GAMING, description: "Jeux vidéo" }] },
  ]);
  assert.deepEqual(managedRoleIds(groups), [L1, L2, INFO, MATHS, GAMING]);
});

test("groupes vides ignorés (modèle à compléter), max ramené au nombre de rôles", () => {
  const groups = parseRoleGroups([
    { label: "Vide", roles: [] },
    { label: "Domaines", max: 10, roles: [INFO] },
  ]);
  assert.deepEqual(groups, [{ label: "Domaines", max: 1, roles: [{ id: INFO }] }]);
});

test("configurations invalides refusées avec un message clair", () => {
  assert.throws(() => parseRoleGroups({}), /liste de groupes/);
  assert.throws(() => parseRoleGroups([{ label: "", roles: [] }]), /label/);
  assert.throws(() => parseRoleGroups([{ label: "Niveau", roles: ["L1"] }]), /n'est pas un identifiant/);
  assert.throws(() => parseRoleGroups([{ label: "A", roles: [L1] }, { label: "B", roles: [L1] }]), /plusieurs fois/);
  assert.throws(() => parseRoleGroups([{ label: "A", max: 0, roles: [L1] }]), /max/);
  const tooMany = Array.from({ length: 26 }, (_, i) => `1000000000000001${String(i).padStart(2, "0")}`);
  assert.throws(() => parseRoleGroups([{ label: "A", roles: tooMany }]), /25 rôles/);
  const sixGroups = Array.from({ length: 6 }, (_, i) => ({ label: `G${i}`, roles: [`20000000000000000${i}`] }));
  assert.throws(() => parseRoleGroups(sixGroups), /5 groupes/);
});

test("choix unique : remplacer le niveau", () => {
  const [niveau] = parseRoleGroups([{ label: "Niveau", max: 1, roles: [L1, L2] }]);
  assert.deepEqual(selectionChanges(niveau!, new Set([L1, INFO]), [L2]), { add: [L2], remove: [L1] });
});

test("choix multiples : seuls les rôles du groupe sont touchés", () => {
  const [domaines] = parseRoleGroups([{ label: "Domaines", roles: [INFO, MATHS] }]);
  assert.deepEqual(selectionChanges(domaines!, new Set([INFO, L1]), [MATHS, INFO]), { add: [MATHS], remove: [] });
  assert.deepEqual(selectionChanges(domaines!, new Set([INFO, MATHS, L1]), []), { add: [], remove: [INFO, MATHS] });
});

test("valeurs inconnues ignorées et sélection tronquée à max", () => {
  const [niveau] = parseRoleGroups([{ label: "Niveau", max: 1, roles: [L1, L2] }]);
  assert.deepEqual(selectionChanges(niveau!, new Set(), [GAMING, L1, L2]), { add: [L1], remove: [] });
});

// 记忆页：每条记忆都标注来源角色（GLOSSARY.md「来源角色」），被取代的记忆标出「已被取代」（ADR-0014）。
// 公共记忆页是全部公共记忆的合集；角色记忆页只按主人聚合：她自己的公共 + 私有。

import { copy } from "@/i18n";
import type { Character, Memory } from "@/lib/api";

/** 角色记忆页的过滤：她的全部、只她的公共、只她的私有。 */
export type MemoryFilter = "all" | "public" | "private";

/** 这条记忆的来源角色；她已经不在配置里（或角色列表还没取到）时为 null。 */
export function sourceCharacter(memory: Memory, characters: readonly Character[]): Character | null {
  return characters.find((c) => c.id === memory.source_character_id) ?? null;
}

/** 被取代的记忆旁边的标记；有效的记忆没有标记。 */
export function supersededMark(memory: Memory): string | null {
  return memory.superseded ? copy.memories.superseded : null;
}

/** 公共记忆页：所有主人的公共记忆。 */
export function publicMemories(memories: readonly Memory[]): Memory[] {
  return memories.filter((m) => !m.private);
}

/** 至少有一条自己的记忆（来源是她，公共/私有、已被取代都算）的角色，保持给定的顺序。 */
export function charactersWithMemories(
  characters: readonly Character[],
  memories: readonly Memory[],
): Character[] {
  const owners = new Set(memories.map((m) => m.source_character_id));
  return characters.filter((c) => owners.has(c.id));
}

/** 这位角色自己的记忆，按 filter 取；顺序沿用传入的顺序（接口的从新到旧）。 */
export function memoriesOfCharacter(
  memories: readonly Memory[],
  characterId: string,
  filter: MemoryFilter = "all",
): Memory[] {
  return memories.filter(
    (m) =>
      m.source_character_id === characterId &&
      (filter === "all" || (filter === "private") === m.private),
  );
}

/** 这位角色自己的记忆条数：全部、公共、私有；包含已被取代的记忆。 */
export function characterMemoryCounts(
  memories: readonly Memory[],
  characterId: string,
): { all: number; publicCount: number; privateCount: number } {
  let all = 0;
  let publicCount = 0;
  let privateCount = 0;
  for (const m of memories) {
    if (m.source_character_id !== characterId) continue;
    all += 1;
    if (m.private) privateCount += 1;
    else publicCount += 1;
  }
  return { all, publicCount, privateCount };
}

/** 每位角色自己的记忆总数（角色条第二行）；只含有记忆的角色。 */
export function memoryCountsByCharacter(memories: readonly Memory[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of memories) {
    counts.set(m.source_character_id, (counts.get(m.source_character_id) ?? 0) + 1);
  }
  return counts;
}

/** 角色记忆页默认选谁：列表里第一个有自己记忆的角色。 */
export function defaultCharacterId(
  characters: readonly Character[],
  memories: readonly Memory[],
): string | null {
  return charactersWithMemories(characters, memories)[0]?.id ?? null;
}

import { describe, expect, it } from "vitest";
import type { Character, Memory } from "@/lib/api";
import {
  characterMemoryCounts,
  charactersWithMemories,
  defaultCharacterId,
  memoriesOfCharacter,
  memoryCountsByCharacter,
  publicMemories,
  sourceCharacter,
  supersededMark,
} from "@/lib/memories";

const character = (id: string, name: string, shortName: string, idolId: number): Character => ({
  id,
  name,
  intro: "",
  avatar_url: `/api/characters/${id}/avatar`,
  scsp_avatar_url: null,
  color: "#ffbad6",
  birthday: "04-25",
  background_url: null,
  stand: null,
  idol_id: idolId,
  short_name: shortName,
  name_zh: null,
  name_kana: null,
  name_romaji: null,
  unit: null,
  unit_reading: null,
  unit_order: null,
  greeting: null,
  call_opener: null,
  call_poster_url: null,
  voxels_url: null,
});

const mano = character("mano", "櫻木真乃", "真乃", 1);
const hiori = character("hiori", "風野灯織", "灯織", 2);

const memory = (
  id: number,
  source: string,
  options: { private?: boolean; superseded?: boolean; text?: string } = {},
): Memory => ({
  id,
  text: options.text ?? "制作人喜欢喝咖啡",
  source_character_id: source,
  source_character_name: source === "mano" ? "櫻木真乃" : source === "hiori" ? "風野灯織" : null,
  created_at: "2026-09-01T12:00:00Z",
  superseded: options.superseded ?? false,
  private: options.private ?? false,
});

describe("sourceCharacter", () => {
  it("找到记忆的来源角色，界面才能用她的颜色和头像标出来", () => {
    expect(sourceCharacter(memory(1, "mano"), [mano])).toBe(mano);
  });

  it("来源角色已经不在配置里时没有角色", () => {
    expect(sourceCharacter(memory(1, "hiori"), [mano])).toBeNull();
  });

  it("角色列表还没取到时也没有角色", () => {
    expect(sourceCharacter(memory(1, "mano"), [])).toBeNull();
  });
});

describe("supersededMark", () => {
  it("被取代的记忆标出「已被取代」", () => {
    expect(supersededMark(memory(1, "mano", { superseded: true }))).toBe("已被取代");
  });

  it("有效的记忆不标", () => {
    expect(supersededMark(memory(1, "mano"))).toBeNull();
  });
});

describe("publicMemories", () => {
  it("只留公共记忆，顺序不变", () => {
    const all = [
      memory(3, "mano"),
      memory(2, "hiori", { private: true }),
      memory(1, "mano", { superseded: true }),
    ];
    expect(publicMemories(all).map((m) => m.id)).toEqual([3, 1]);
  });
});

describe("charactersWithMemories", () => {
  it("只列有自己记忆的角色，保持给定顺序", () => {
    const all = [memory(2, "hiori"), memory(1, "mano", { private: true })];
    expect(charactersWithMemories([mano, hiori], all)).toEqual([mano, hiori]);
    expect(charactersWithMemories([hiori, mano], all)).toEqual([hiori, mano]);
  });

  it("一条自己的记忆都没有的角色不列；别人的公共记忆不算她的", () => {
    const all = [memory(1, "mano")];
    expect(charactersWithMemories([mano, hiori], all)).toEqual([mano]);
  });

  it("没有记忆时是空的", () => {
    expect(charactersWithMemories([mano, hiori], [])).toEqual([]);
  });
});

describe("memoriesOfCharacter", () => {
  const all = [
    memory(5, "mano", { private: true }),
    memory(4, "hiori"),
    memory(3, "mano"),
    memory(2, "mano", { superseded: true }),
  ];

  it("全部 = 她自己的公共 + 私有，不含别人的", () => {
    expect(memoriesOfCharacter(all, "mano").map((m) => m.id)).toEqual([5, 3, 2]);
  });

  it("公共、私有分开", () => {
    expect(memoriesOfCharacter(all, "mano", "public").map((m) => m.id)).toEqual([3, 2]);
    expect(memoriesOfCharacter(all, "mano", "private").map((m) => m.id)).toEqual([5]);
  });

  it("顺序沿用传入的顺序", () => {
    expect(memoriesOfCharacter(all, "mano").map((m) => m.id)).toEqual([5, 3, 2]);
  });
});

describe("characterMemoryCounts", () => {
  it("全部、公共、私有都算上被取代的", () => {
    const all = [
      memory(5, "mano", { private: true }),
      memory(4, "hiori"),
      memory(3, "mano"),
      memory(2, "mano", { private: true, superseded: true }),
    ];
    expect(characterMemoryCounts(all, "mano")).toEqual({ all: 3, publicCount: 1, privateCount: 2 });
    expect(characterMemoryCounts(all, "hiori")).toEqual({ all: 1, publicCount: 1, privateCount: 0 });
  });
});

describe("memoryCountsByCharacter", () => {
  it("按主人数总数，角色条第二行用它", () => {
    const all = [memory(3, "mano"), memory(2, "hiori"), memory(1, "mano")];
    expect(memoryCountsByCharacter(all)).toEqual(new Map([["mano", 2], ["hiori", 1]]));
  });
});

describe("defaultCharacterId", () => {
  it("默认选列表里第一个有自己记忆的角色", () => {
    const all = [memory(1, "hiori")];
    expect(defaultCharacterId([mano, hiori], all)).toBe("hiori");
  });

  it("没有角色有记忆时为 null", () => {
    expect(defaultCharacterId([mano, hiori], [])).toBeNull();
  });
});

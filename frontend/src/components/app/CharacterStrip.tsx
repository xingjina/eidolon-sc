import type { ReactNode } from "react";

import { MarkedAvatar } from "@/components/app/MarkedAvatar";
import type { Character } from "@/lib/api";
import { shortName } from "@/lib/schedule";
import { cn } from "@/lib/utils";

/**
 * 一排可横滑的角色头像条：48px 头像加短名，选中的铺中性 `bg-muted`。
 * 可选第二行（记忆页的「n 条」）；周期子页和记忆页共用。
 */
export function CharacterStrip({
  characters,
  picked,
  onPick,
  detail,
  pickLabel,
  noMatch,
}: {
  characters: Character[];
  picked: string | null;
  onPick: (id: string) => void;
  /** 名字下面的一行；不传时只有头像和名字。 */
  detail?: (character: Character) => ReactNode;
  /** 读屏名字，默认是她的全名。 */
  pickLabel?: (character: Character) => string;
  /** 没有可显示的角色时的一句话。 */
  noMatch?: ReactNode;
}) {
  return (
    <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1">
      {characters.map((c) => (
        <button
          key={c.id}
          type="button"
          aria-pressed={c.id === picked}
          aria-label={pickLabel?.(c) ?? c.name}
          title={c.name}
          onClick={() => onPick(c.id)}
          className={cn(
            "flex w-16 shrink-0 flex-col items-center gap-1 rounded-xl py-2 outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50",
            c.id === picked && "bg-muted hover:bg-muted",
          )}
        >
          <MarkedAvatar name={c.name} src={c.avatar_url} />
          <span className="w-full truncate px-1 text-center text-meta">{shortName(c)}</span>
          {detail && (
            <span className="w-full truncate px-1 text-center text-meta text-muted-foreground">{detail(c)}</span>
          )}
        </button>
      ))}
      {noMatch}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

import { CharacterStrip } from "@/components/app/CharacterStrip";
import { FailureNotice } from "@/components/app/FailureNotice";
import { PROSE_WIDTH } from "@/components/app/SettingsSection";
import { useDirectory } from "@/components/conversations/ConversationDirectory";
import { MemoryRow } from "@/components/memories/MemoryRow";
import { SettingsPane } from "@/components/settings/SettingsPane";
import { useSettingsValues } from "@/components/settings/SettingsValues";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { copy } from "@/i18n";
import {
  ApiError,
  clearMemories,
  deleteMemory,
  listMemories,
  restoreMemory,
  updateMemory,
  type Memory,
} from "@/lib/api";
import { toFailure, type Failure } from "@/lib/failure";
import {
  characterMemoryCounts,
  charactersWithMemories,
  defaultCharacterId,
  memoriesOfCharacter,
  memoryCountsByCharacter,
  publicMemories,
  sourceCharacter,
  type MemoryFilter,
} from "@/lib/memories";
import { cn } from "@/lib/utils";
import { SuccessIcon } from "@/theme/icons";

const t = copy.memories;

type Tab = "public" | "character";

/** 改完可见范围后的一行提示：「去看」按需要切到对应的 Tab / 角色 / 过滤。 */
type Notice = { text: string; action?: { label: string; onClick: () => void } };

/**
 * 设置「记忆」：两个 Tab。
 * - 公共记忆：所有角色的公共记忆放在一起，行样式和以前一样。
 * - 角色记忆：只列有自己记忆的角色；选中后看她自己的公共 + 私有，私有的行铺她的颜色，
 *   上方用「全部 / 公共 / 私有」过滤（所有角色共享这个状态）。
 * 改公共/私有仍然走行尾铅笔 + 编辑弹窗，只改这一条的可见范围，不换主人。
 * 「清空」在二级页首的末端。条数一变就告诉设置的 layout，一级「记忆」的摘要跟着变。
 */
export function MemoriesSettings() {
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [deleting, setDeleting] = useState<Set<number>>(new Set());
  const [restoring, setRestoring] = useState<Set<number>>(new Set());
  // 要删的那条。确认框关上时只把 confirmingDelete 置成 false，pendingDelete 留着，关闭动画里的文字不会闪成空白。
  const [pendingDelete, setPendingDelete] = useState<Memory | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  // 正在编辑的那条：编辑框开着时是它，draft 是框里的字。
  const [editing, setEditing] = useState<Memory | null>(null);
  const [draft, setDraft] = useState("");
  const [draftPrivate, setDraftPrivate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editFailure, setEditFailure] = useState<Failure | null>(null);
  // 只用最后一次重新取到的列表：连着删几条时，先发出的那次晚到，会把后删的又列出来。
  const refetches = useRef(0);
  const { memoryCountChanged } = useSettingsValues();
  // 记忆页用肖像头像，不受「外观 - SCSP 头像」影响；还没载入时为空，记忆行照旧按名字兜底。
  const { configuredCharacters } = useDirectory();
  const characters = configuredCharacters ?? [];
  const [tab, setTab] = useState<Tab>("public");
  const [picked, setPicked] = useState<string | null>(null);
  const [filter, setFilter] = useState<MemoryFilter>("all");
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    listMemories().then(setMemories, (e) => setFailure(toFailure(e)));
  }, []);

  const count = memories?.length;
  useEffect(() => {
    if (count !== undefined) memoryCountChanged(count);
  }, [count, memoryCountChanged]);

  const publicList = memories ? publicMemories(memories) : [];
  const owners = memories ? charactersWithMemories(characters, memories) : [];
  const defaultId = memories ? defaultCharacterId(characters, memories) : null;
  const selectedId = picked && owners.some((c) => c.id === picked) ? picked : defaultId;
  const selected = owners.find((c) => c.id === selectedId) ?? null;
  const selectedCounts = selected
    ? characterMemoryCounts(memories ?? [], selected.id)
    : { all: 0, publicCount: 0, privateCount: 0 };
  const countsByOwner = memoryCountsByCharacter(memories ?? []);
  const rows = selected ? memoriesOfCharacter(memories ?? [], selected.id, filter) : [];
  const publicCount = publicList.length;
  const privateCount = (memories?.length ?? 0) - publicCount;

  const forget = (id: number) => setMemories((list) => list?.filter((m) => m.id !== id) ?? null);

  function askToRemove(memory: Memory) {
    setPendingDelete(memory);
    setConfirmingDelete(true);
  }

  async function remove(memory: Memory) {
    const id = memory.id;
    setConfirmingDelete(false);
    setDeleting((ids) => new Set(ids).add(id));
    setFailure(null);
    setNotice(null);
    try {
      await deleteMemory(id);
      forget(id);
      // 删掉的是取代别的记忆的那条时，被它取代的会恢复，重新取一次才看得到；取不到时照旧列着。
      const refetch = ++refetches.current;
      listMemories().then((list) => refetch === refetches.current && setMemories(list), () => {});
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) forget(id); // 已经删掉了
      else setFailure(toFailure(e));
    } finally {
      setDeleting((ids) => {
        const rest = new Set(ids);
        rest.delete(id);
        return rest;
      });
    }
  }

  async function clear() {
    setClearing(true);
    setFailure(null);
    try {
      await clearMemories();
      setMemories([]);
      setConfirmingClear(false);
      setNotice(null);
    } catch (e) {
      setFailure(toFailure(e));
      setConfirmingClear(false);
    } finally {
      setClearing(false);
    }
  }

  function startEditing(memory: Memory) {
    setEditing(memory);
    setDraft(memory.text);
    setDraftPrivate(memory.private);
    setEditFailure(null);
    setNotice(null);
  }

  function closeEditing() {
    if (saving) return;
    setEditing(null);
    setDraft("");
    setDraftPrivate(false);
    setEditFailure(null);
  }

  async function save() {
    if (!editing) return;
    const text = draft.trim();
    if (!text) return;
    const privateNow = draftPrivate;
    if (text === editing.text && privateNow === editing.private) {
      closeEditing();
      return;
    }
    const id = editing.id;
    const ownerId = editing.source_character_id;
    const ownerName = editing.source_character_name ?? t.goneCharacter;
    const wasPrivate = editing.private;
    setSaving(true);
    setEditFailure(null);
    try {
      await updateMemory(id, text, privateNow);
      setMemories(
        (list) => list?.map((m) => (m.id === id ? { ...m, text, private: privateNow } : m)) ?? null,
      );
      setEditing(null);
      setDraft("");
      setDraftPrivate(false);
      if (wasPrivate === privateNow) return;
      if (privateNow) {
        // 公共页改成私有：行离开公共页，回到主人的角色记忆；在角色页里只是换颜色。
        setNotice({
          text: tab === "public" ? t.movedToPrivate(ownerName) : t.nowPrivate(ownerName),
          action:
            tab === "public" || filter === "public"
              ? {
                  label: t.goSee,
                  onClick: () => {
                    setTab("character");
                    setPicked(ownerId);
                    setFilter("private");
                    setNotice(null);
                  },
                }
              : undefined,
        });
      } else {
        // 私有改成公共：公共页多一条；角色页在「私有」过滤下会离开当前列表。
        setNotice({
          text: tab === "public" ? t.movedToPublic : t.nowPublic,
          action:
            tab === "character" && filter === "private"
              ? { label: t.goSee, onClick: () => setFilter("public") }
              : undefined,
        });
      }
    } catch (e) {
      setEditFailure(toFailure(e));
    } finally {
      setSaving(false);
    }
  }

  async function restore(memory: Memory) {
    const id = memory.id;
    setRestoring((ids) => new Set(ids).add(id));
    setFailure(null);
    try {
      await restoreMemory(id);
      setMemories((list) => list?.map((m) => (m.id === id ? { ...m, superseded: false } : m)) ?? null);
    } catch (e) {
      setFailure(toFailure(e));
    } finally {
      setRestoring((ids) => {
        const rest = new Set(ids);
        rest.delete(id);
        return rest;
      });
    }
  }

  const hasMemories = !!memories && memories.length > 0;
  const pendingName = pendingDelete?.source_character_name ?? t.goneCharacter;
  const pendingDescription = pendingDelete
    ? pendingDelete.private
      ? t.removeDescriptionPrivate(pendingDelete.text, pendingName)
      : t.removeDescription(pendingDelete.text)
    : "";

  return (
    <SettingsPane
      category="memories"
      end={
        hasMemories && (
          <Button variant="ghost" size="sm" onClick={() => setConfirmingClear(true)} disabled={clearing}>
            {t.clear}
          </Button>
        )
      }
    >
      <div className="flex flex-1 flex-col gap-4">
        <p className={cn(PROSE_WIDTH, "text-body text-muted-foreground")}>{t.intro}</p>

        {failure && <FailureNotice failure={failure} />}

        {memories === null ? (
          !failure && <p className="text-body text-muted-foreground">{t.loading}</p>
        ) : memories.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t.empty}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <Tabs
              value={tab}
              onValueChange={(value) => {
                if (value !== "public" && value !== "character") return;
                setTab(value as Tab);
                setNotice(null);
              }}
            >
              <TabsList aria-label={t.tabsLabel} className="w-full">
                <TabsTrigger value="public" className="flex-1">
                  {t.publicTab}
                </TabsTrigger>
                <TabsTrigger value="character" className="flex-1">
                  {t.characterTab}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {notice && (
              <div role="status" className="flex flex-wrap items-center gap-2 text-body text-muted-foreground">
                <SuccessIcon className="size-4 shrink-0" />
                <span>{notice.text}</span>
                {notice.action && (
                  <Button variant="ghost" size="sm" onClick={notice.action.onClick}>
                    {notice.action.label}
                  </Button>
                )}
              </div>
            )}

            {tab === "public" ? (
              publicList.length === 0 ? (
                <p className="py-8 text-center text-body text-muted-foreground">{t.publicTabEmpty}</p>
              ) : (
                <ul className="flex flex-col divide-y">
                  {publicList.map((memory) => (
                    <MemoryRow
                      key={memory.id}
                      memory={memory}
                      source={sourceCharacter(memory, characters)}
                      tinted={false}
                      gutter={false}
                      busy={deleting.has(memory.id)}
                      restoring={restoring.has(memory.id)}
                      disabled={clearing}
                      onEdit={() => startEditing(memory)}
                      onRemove={() => askToRemove(memory)}
                      onRestore={() => restore(memory)}
                    />
                  ))}
                </ul>
              )
            ) : configuredCharacters === null ? (
              <p className="text-body text-muted-foreground">{t.loading}</p>
            ) : owners.length === 0 || !selected ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t.charactersEmpty}</EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : (
              <>
                <CharacterStrip
                  characters={owners}
                  picked={selectedId}
                  onPick={(id) => {
                    setPicked(id);
                    setNotice(null);
                  }}
                  detail={(c) => t.count(countsByOwner.get(c.id) ?? 0)}
                  pickLabel={(c) => t.pickLabel(c.name, countsByOwner.get(c.id) ?? 0)}
                />
                <ToggleGroup
                  aria-label={t.filterLabel}
                  variant="outline"
                  size="sm"
                  value={[filter]}
                  onValueChange={(next) => {
                    const [chosen] = next;
                    if (chosen !== "all" && chosen !== "public" && chosen !== "private") return;
                    setFilter(chosen);
                    setNotice(null);
                  }}
                >
                  <ToggleGroupItem value="all">
                    {t.filters.all} {selectedCounts.all}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="public">
                    {t.filters.public} {selectedCounts.publicCount}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="private">
                    {t.filters.private} {selectedCounts.privateCount}
                  </ToggleGroupItem>
                </ToggleGroup>
                {rows.length === 0 ? (
                  <p className="py-8 text-center text-body text-muted-foreground">
                    {filter === "private"
                      ? t.privateEmpty
                      : filter === "public"
                        ? t.publicEmptyForHer
                        : t.hersEmpty(selected.name)}
                  </p>
                ) : (
                  <ul className="flex flex-col divide-y">
                    {rows.map((memory) => (
                      <MemoryRow
                        key={memory.id}
                        memory={memory}
                        source={sourceCharacter(memory, characters)}
                        tinted={memory.private}
                        gutter
                        busy={deleting.has(memory.id)}
                        restoring={restoring.has(memory.id)}
                        disabled={clearing}
                        onEdit={() => startEditing(memory)}
                        onRemove={() => askToRemove(memory)}
                        onRestore={() => restore(memory)}
                      />
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        )}
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && closeEditing()}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.editTitle}</DialogTitle>
            <DialogDescription>{t.editHint}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={200}
            rows={4}
            aria-label={t.editTitle}
          />
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2 text-body">
              <Checkbox
                checked={draftPrivate}
                onCheckedChange={(checked) => setDraftPrivate(checked === true)}
              />
              <span>{t.privateLabel(editing?.source_character_name ?? t.goneCharacter)}</span>
            </label>
            {editing && draftPrivate !== editing.private && (
              <p className="text-subtitle text-muted-foreground">
                {draftPrivate ? t.privateHintOn : t.privateHintOff}
              </p>
            )}
          </div>
          {editFailure && <FailureNotice failure={editFailure} />}
          <DialogFooter>
            <Button variant="ghost" onClick={closeEditing} disabled={saving}>
              {copy.common.cancel}
            </Button>
            <Button onClick={save} disabled={saving || !draft.trim()}>
              {saving && <Spinner data-icon="inline-start" />}
              {t.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.removeTitle}</AlertDialogTitle>
            <AlertDialogDescription>{pendingDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{copy.common.cancel}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => pendingDelete && remove(pendingDelete)}>
              {t.remove}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmingClear} onOpenChange={(open) => !clearing && setConfirmingClear(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.clearTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.clearDescription(memories?.length ?? 0, publicCount, privateCount)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearing}>{copy.common.cancel}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={clearing} onClick={clear}>
              {clearing && <Spinner data-icon="inline-start" />}
              {t.clearConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPane>
  );
}

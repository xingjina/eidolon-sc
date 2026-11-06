import type { EventKind } from "@/lib/api";
import { EndedIcon, GiftIcon, HangUpIcon, InPersonIcon, OnPhoneIcon, UnwellIcon } from "@/theme/icons";

/** 每种对话事件的图标：消息区的分隔线和列表的「最后一句」共用；那句话见 `lib/conversationEvents`。 */
export const EVENT_ICONS: Record<EventKind, typeof HangUpIcon> = {
  hung_up: HangUpIcon,
  gift: GiftIcon,
  ended: EndedIcon,
  unwell: UnwellIcon,
  in_person: InPersonIcon,
  on_phone: OnPhoneIcon,
};

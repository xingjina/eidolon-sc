"""The bar's prompt (ADR-0020's layout, its own and not the text turns'), the same four parts
in every call of a visit:

1. what she is and how a visit is written, the same for every user's visits with her that
   day, marked for the service to cache: her sheet, her birthday, the world setting, the
   IF the bar is in and what it keeps to, how a visit goes and the output format;
2. this visit, the same for each of its calls: who the producer is, why she came and what
   she is to talk about, how many drinks she has, her affinity, what day it is, what she
   remembers of her visits with the producer before, her tastes at the bar and those of her
   character facts the topic finds (`bar_facts`);
3. what each call before asked for and what was written, the last marked for the service to
   cache;
4. what this call is to write: her coming in and ordering, her reaction to a drink and her
   next order, or her reaction to the last and her farewell, drunk from after the reaction
   on if that drink left her so; with her order card, and the drink served and how well.

No tool is offered, nothing is retrieved but her facts; neither the conversations nor her
memories are told of. Nor is she told what else would have been right for an order.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from eidolon.affinity import day_of
from eidolon.bar_lines import Phrasing, Tier
from eidolon.bar_reply import BarLine
from eidolon.bar_rules import (
    FLAVORS,
    KINDS,
    LONG_AGO,
    NAMING,
    REGULAR_VISITS,
    Had,
    Order,
    Reason,
    Serving,
    Wrong,
)
from eidolon.bar_visits import Mood, Topic
from eidolon.characters import Character
from eidolon.drink_catalog import Drink, DrinkCatalog, Served
from eidolon.facts import CharacterFacts
from eidolon.llm import ChatMessage
from eidolon.today import always_known

_TOLERANCES = {"weak": "不太能喝", "medium": "一般", "strong": "很能喝"}
MOODS: dict[Mood, str] = {
    "happy": "开心", "annoyed": "烦躁", "tired": "疲惫", "down": "低落", "calm": "平静",
}
_TIERS: dict[Tier, str] = {"best": "上得最好", "right": "上对了", "wrong": "上错了"}

_IF = """\
# 这里是 VA-283
这是一个 IF 的故事：所有人都已经到了能喝酒的年纪；除此之外你还是你，仍是 283 事务所的偶像，制作人仍是你的制作人。制作人下班以后在一家叫「VA-283」的小酒吧当酒保，你今晚来店里光顾，就是来找制作人的。
- 不提你或别人的具体年龄，也不讨论「其实还没成年」之类的话；不解释制作人为什么在这里当酒保。
- 喝醉了也只是话多、犯困、情绪起伏、说说心里话；可以亲近、可以暧昧，但不写露骨的情色内容，遇到就照你的方式轻轻带过。人设里不该说的话照旧不说。
- 你不知道你们在别处聊过什么；这里只有今晚店里的事，和你记得的以前来店里的事。"""

_WRITING = """\
# 一次光顾怎么写
你来写你和制作人的台词，制作人是酒保。每次只写最后一条消息要你写的那几段，写完就停，等制作人下一步。
- 进门：5 到 7 句。按你来过几次打招呼，用来意定下心情，来意可以先只露一半；今天是你自己或组合伙伴的生日的话，在这里提一句；别人的生日和节日不用特意提，制作人说起再接。
- 点单：先铺垫 1 到 2 句，然后照点单卡说出你要什么。说出点单的那一两句标上 order="true"，放在这次输出的最后；要什么只在这一两句里说：铺垫只说想来一杯、说说心情，不先说这一杯想要什么样的。点单卡上的条件一个不漏，没有的一个不加：卡上没写的，就不说加冰、大杯、什么口味或不要酒精（打比方照描述说，不算加条件）。
- 上酒后的反应：2 到 4 句，照给你的判定写；上得对不对由判定说了算，不要自己判断。上错了抱怨几句就照常往下聊，不要求重做。
- 闲聊：8 到 12 句，围着话题聊，来意也往深里说一点；最后一杯后的闲聊短一些，4 到 6 句。
- 告别：2 到 4 句，收住来意，心情比进门时有了变化，用一句话带出这次喝得怎么样，可以说下次再来。
- 句数是你和制作人合计的。制作人是在和你聊天：进门、反应和告别里都有他一两句；闲聊里你们一来一回，他接话、追问、说说自己的看法和今天的小事，占三到四成，不要连着好几句都是你在说。他不替你挑饮品、不提议你点什么，只说中文。
- 不写选项，不替制作人做决定，也不写制作人调酒、上酒：那由制作人自己来。
- 今天、今晚的小事和心情可以即兴；过去的经历，家人、组合伙伴和别的偶像的名字、关系和设定，只用人设和「角色资料」里有的，没有的就说得笼统些，不编具体的名字和事件。"""

_FORMAT = """\
# 输出格式
每句台词一组。你的台词用日语，后面附中文字幕，并标上说这句时的表情；制作人的台词只写中文：
<her emotion="happy"><ja>日语台词</ja><zh>中文字幕</zh></her>
<producer>制作人的台词</producer>
<her emotion="calm" order="true"><ja>点单的那句</ja><zh>它的中文字幕</zh></her>
- 表情只能是 calm、happy、shy、surprised、sad、angry、thinking 之一。
- 中文字幕照日语台词完整译出，不增不减；日语台词里不夹英文。
- 饮品的名字在日语台词里用日文名，在中文字幕里用英文原名，不要翻译。
- 制作人的台词只用中文写，前面都是日语也一样；不写日语，不套 <ja>、<zh>，不加引号。
- 除了这些标签和标签里的内容，不要输出任何其他文字，也不要写动作和旁白。"""


@dataclass(frozen=True)
class Remembered:
    """What she remembers of her visits with the user done before this one."""

    visits: int
    last_left_at: datetime | None = None
    last_orders: tuple[Had, ...] = ()
    last_drunk: bool = False


def shared_prompt(character: Character, world_prompt: str | None) -> str:
    """The first part: what every user's visits with her open with that day."""
    return "\n\n".join([*always_known(character, world_prompt), _IF, _WRITING, _FORMAT])


def visit_prompt(
    about_producer: str,
    reason: Reason,
    topic: Topic,
    cups: int,
    now_lines: Sequence[str],
    remembered: Remembered,
    now: datetime,
    character: Character,
    catalog: DrinkCatalog,
    facts: Sequence[str],
) -> str:
    """The second part: this visit, as it is at `now`, as she comes in, what she knows of
    now (`now_lines`, `her_now.HerNow`) in it, with those of her `facts` the topic found, best
    first."""
    if reason.job:
        why = (
            f"你今天完成了制作人排给你的工作「{reason.id}」（{reason.note}），"
            "收工以后来了店里。心情按你做这项工作的样子来定。"
        )
    else:
        assert reason.mood is not None
        why = f"你今晚来的缘由：{reason.note}进门时的心情：{MOODS[reason.mood]}。"
    visit = [
        "# 这次光顾", why, f"闲聊的话题：{topic.note}", f"你今晚打算喝 {cups} 杯，喝完就告别。",
        *now_lines,
    ]
    parts = [
        about_producer, "\n".join(visit), _remembered(remembered, now, catalog),
        _tastes(character, catalog),
    ]
    if facts:
        parts.append(_facts(facts))
    return "\n\n".join(parts)


_CHINESE = "制作人的台词只写中文。"


def opening_ask(order: Order) -> str:
    """The last part of the first call: her coming in and ordering."""
    return "\n\n".join([f"这次写：进门，然后点第一杯。{_CHINESE}", order_card(order)])


def serving_ask(serving: Serving, enjoy: str, order: Order) -> str:
    """The last part of a call after a drink is served her with the producer saying `enjoy`,
    another to come: her reaction, the talk and her next order."""
    return "\n\n".join([
        _served(serving, enjoy),
        f"这次写：这杯的反应、闲聊，然后点下一杯。{_CHINESE}",
        order_card(order),
    ])


def farewell_ask(
    serving: Serving, enjoy: str, servings: Sequence[Serving], *, drunk: bool
) -> str:
    """The last part of the call after the last drink of `servings` is served her, the last
    she has, `drunk` or not: her reaction, a short talk and her farewell, drunk after her
    reaction if she is."""
    each = "；".join(f"第 {i} 杯{_TIERS[s.tier]}" for i, s in enumerate(servings, 1))
    parts = [
        _served(serving, enjoy), f"这次写：这杯的反应、一小段闲聊，然后告别。不再点单。{_CHINESE}",
    ]
    if drunk:
        parts.append(
            "这杯的反应照常写；写完反应，从这一段起你醉了：闲聊和告别都是醉着的样子，"
            "话多、犯困、情绪起伏，会说说心里话。"
        )
    parts.append(f"这次的每一杯：{each}。你今晚{'喝醉了' if drunk else '没有喝醉'}。")
    return "\n\n".join(parts)


_PHRASINGS: dict[Phrasing, str] = {
    "name": "直接说出饮品的名字。",
    "name_big": "直接说出饮品的名字，并说要大杯。",
    "flavor": "只说想要什么口味的，不说是哪一款。",
    "kind": "只说想要哪一类的，可以绕着说（比如想要「烈一点的」就是男性化），不说是哪一款。",
    "conditions": "把下面这几个条件一起说出来，不说是哪一款。",
    "analogy": (
        "照这款饮品的描述，用你自己的话打个比方，让制作人猜是哪一款；不要照抄描述。"
        "比方整个写在标 order=\"true\" 的那一两句里，不拆到铺垫里。"
    ),
    "my_favorite": "让制作人上一杯你喜欢的，不说是哪一款，看制作人记不记得你的口味。",
    "your_call": "让制作人帮你拿主意，不说想要什么。",
    "usual": "说要「老样子」，也就是上次来时喝的那款，不说是哪一款。",
}


def order_card(order: Order) -> str:
    """What she is to order, and how: never what else would be right for it."""
    drink = order.target
    card = [
        "点单卡：",
        f"- 说法：{_PHRASINGS[order.phrasing]}",
        f"- 饮品：{drink.name}（日文名 {drink.name_ja}），{_described(drink)}。",
    ]
    if order.phrasing == "analogy":
        card.append(f"- 描述：{drink.description}")
    if order.phrasing in NAMING:
        card.append(
            f"- 名字：要说出来，日语台词里说「{drink.name_ja}」，中文字幕里写「{drink.name}」。"
        )
    else:
        card.append("- 名字：不能说出来。日语台词和中文字幕里都不要出现任何饮品的名字。")
    card.append(f"- 要提的条件：{'、'.join(order.words()) or '没有'}。")
    return "\n".join(card)


def rewrite_ask(ask: str, order: Order, before: Sequence[BarLine]) -> str:
    """`ask` again, but for her order alone, which named drinks where it should not, or not
    the one it should, after the lines `before` it, which stand."""
    drink = order.target
    naming = (
        f"一定要说出名字：日语台词里说「{drink.name_ja}」，中文字幕里写「{drink.name}」。"
        if order.phrasing in NAMING else "不要提任何饮品的名字，日语台词和中文字幕里都不行。"
    )
    written = "\n".join(line.written() for line in before)
    return "\n\n".join([
        ask,
        *([f"这次前面已经写好了这些，不用再写：\n{written}"] if before else []),
        "你接着写的点单那一两句不合要求。这次只重写点单的那一两句，标上 order=\"true\"，别的都不写。"
        + naming,
    ])


def prompt(
    shared: str, visit: str, written: Sequence[tuple[str, Sequence[BarLine]]], ask: str
) -> list[ChatMessage]:
    """The prompt of a call of a visit, after the calls `written`, each with what it asked
    for and what came of it."""
    messages = [ChatMessage("system", shared, cache_breakpoint=True), ChatMessage("system", visit)]
    for asked, lines in written:
        messages.append(ChatMessage("user", asked))
        messages.append(ChatMessage("assistant", "\n".join(line.written() for line in lines)))
    if written:  # what the next call opens with too, for a service to cache
        messages[-1] = ChatMessage("assistant", messages[-1].content, cache_breakpoint=True)
    messages.append(ChatMessage("user", ask))
    return messages


def _described(drink: Drink) -> str:
    return f"口味{FLAVORS[drink.flavor]}，种类{KINDS[drink.kind]}"


def _served(serving: Serving, enjoy: str) -> str:
    served = serving.served
    lines = [
        f"制作人给你上了一杯 {_glass(served)}，说：「{enjoy}」",
        f"判定：{_TIERS[serving.tier]}。",
    ]
    if serving.wrong is not None:
        lines.append(_wrong(serving.wrong, served))
    elif served.drink.id != serving.order.target.id:
        lines.append("这杯不是点单卡上那款，但也合你的意：不要说这杯和你想的不一样。")
    return "\n".join(lines)


def _glass(served: Served) -> str:
    drink = served.drink
    alcohol = "含酒精" if served.alcoholic else "不含酒精"
    big = "，大杯" if served.big else ""
    return f"{drink.name}（{_described(drink)}{big}，{alcohol}）"


_WRONGS: dict[Wrong, str] = {
    "not_usual": "错在哪：你要的是老样子，这杯不是上次那款。",
    "flavor_only": "错在哪：口味对了，种类不对。",
    "kind_only": "错在哪：种类对了，口味不对。",
    "off": "错在哪：不是你要的，完全不对。",
}


def _wrong(wrong: Wrong, served: Served) -> str:
    if wrong == "disliked":
        return (
            f"错在哪：这是你讨厌的{FLAVORS[served.drink.flavor]}口味。"
            "要写成明显的不喜欢，但不赶人、不翻脸。"
        )
    if wrong == "alcohol":
        return "错在哪：你说了不要酒精，这杯却有酒。要写成明显的不喜欢，但不赶人、不翻脸。"
    return _WRONGS[wrong]


def _remembered(remembered: Remembered, now: datetime, catalog: DrinkCatalog) -> str:
    lines = ["# 你在 VA-283 的记录"]
    if remembered.visits == 0 or remembered.last_left_at is None:
        lines.append("这是你第一次来 VA-283。")
        return "\n".join(lines)
    if remembered.visits >= REGULAR_VISITS:
        lines.append(f"你是这里的常客，已经来过 {remembered.visits} 次了。")
    else:
        lines.append(f"你来过 {remembered.visits} 次了。")
    days = (day_of(now) - day_of(remembered.last_left_at)).days
    lines.append(_ago(days))
    if now - remembered.last_left_at > LONG_AGO:
        lines.append("很久没来了，进门时可以提一句好久不见。")
    each = "；".join(
        f"第 {i} 杯要的是 {_name(catalog, h.target)}，制作人上的是 {_name(catalog, h.served)}"
        f"{'（大杯）' if h.big else ''}，{_TIERS[h.tier]}"
        for i, h in enumerate(remembered.last_orders, 1)
    )
    lines.append(f"上次点的：{each}。")
    lines.append(
        "上次喝醉了，可以提一句，但不会因此只点不含酒精的。" if remembered.last_drunk
        else "上次没有喝醉。"
    )
    lines.append("聊过什么你不记得了。")
    return "\n".join(lines)


def _name(catalog: DrinkCatalog, id: str) -> str:
    """A drink's name, or its identifier if the catalog no longer has it."""
    drink = catalog.drinks.get(id)
    return drink.name if drink else id


def _ago(days: int) -> str:
    if days < 2:
        return f"上次来是{'今天早些时候' if days == 0 else '昨天'}。"
    return f"上次来是 {days} 天前。"


def _tastes(character: Character, catalog: DrinkCatalog) -> str:
    lines = [
        "# 你在酒吧的口味",
        f"喜欢的口味：{'、'.join(FLAVORS[f] for f in character.bar_flavors)}。",
    ]
    if character.bar_kind:
        lines.append(f"喜欢的种类：{KINDS[character.bar_kind]}。")
    favorites = "、".join(catalog.drinks[d].name for d in character.bar_favorites)
    lines.append(f"爱喝的：{favorites}。")
    if character.bar_disliked_flavor:
        lines.append(f"讨厌的口味：{FLAVORS[character.bar_disliked_flavor]}。")
    if character.bar_tolerance:
        lines.append(f"酒量：{_TOLERANCES[character.bar_tolerance]}。")
    lines.append(
        "这些可以在闲聊里偶尔自然地带出一点，让制作人慢慢摸清；不要一口气说出来，闲聊里也不要用"
        f"「{KINDS['girly']}」「{KINDS['promo']}」这类菜单上的分类词说自己的口味。"
    )
    return "\n".join(lines)



def _facts(facts: Sequence[str]) -> str:
    lines = [
        f"# {CharacterFacts.heading}",
        f"{CharacterFacts.guide}下面几条和这次的话题可能有关，聊到时照这些说，用不上的可以不提。",
    ]
    for fact in facts:
        lines += ["", fact]
    return "\n".join(lines)

"""A visit to the bar (GLOSSARY.md「光顾」), driven through the backend's external API: she
comes in and orders, is served each drink and reacts, and says goodbye, the chat model
writing every line from a script and the random source drawing why she came, what about, how
many drinks, which and how she orders them (always by name here: how else is
`test_bar_orders`'s). Mano is the only character, so she is the one who comes; who comes is
`test_bar_draws`'s."""

import asyncio
import json
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from eidolon.bar_prompt import MOODS
from eidolon.bar_visits import BAR_VISITS_FILE, load_bar_visits
from eidolon.config import Settings
from eidolon.drink_catalog import load_drink_catalog
from tests.conftest import MANO_SHEET, REPO_DRINKS, CharacterConfig, ClientFactory
from tests.fakes import FAKE_JUDGE, FakeClock, FakeIdentityProvider, FakeLLM, FakeRandom
from tests.test_admin_users import ADMIN, admin_beside
from tests.test_affinity import keep
from tests.test_world_setting import write_world

CATALOG = load_drink_catalog(REPO_DRINKS)

MANO_TASTES: dict[str, object] = {
    "bar_flavors": ["sweet"], "bar_kind": "girly", "bar_favorites": ["sugar-rush"],
    "bar_disliked_flavor": "bitter", "bar_tolerance": "strong",
}


def mano_alone(directory: Path) -> CharacterConfig:
    """A character configuration in `directory` with Mano alone, liking what is sweet and
    girly, Sugar Rush best, disliking what is bitter, and holding her drink well."""
    return CharacterConfig(directory).add(
        "mano", "櫻木真乃", MANO_SHEET, birthday="04-25", bar=MANO_TASTES
    )


@pytest.fixture
def characters(tmp_path: Path) -> CharacterConfig:
    return mano_alone(tmp_path / "characters")

VISITS = "/api/bar/visits"


def her(ja: str, zh: str | None = None, emotion: str = "calm", *, order: bool = False) -> str:
    marked = ' order="true"' if order else ""
    subtitle = f"<zh>{zh}</zh>" if zh is not None else ""
    return f'<her emotion="{emotion}"{marked}><ja>{ja}</ja>{subtitle}</her>'


def producer(zh: str) -> str:
    return f"<producer>{zh}</producer>"


def coming_in(drink_id: str = "sugar-rush") -> list[str]:
    """Her coming in and ordering the drink by name, as the first call writes it."""
    drink = CATALOG.drinks[drink_id]
    return [
        her("こんばんは。", "晚上好。", "happy"),
        producer("欢迎。"),
        her(f"{drink.name_ja}をください。", f"请给我一杯 {drink.name}。", order=True),
    ]


COMING_IN = coming_in()
"""Her coming in and ordering Sugar Rush."""


def reacting(drink_id: str) -> list[str]:
    """Her reaction, the talk and her next order, the drink by name in her last line, none
    marked as her order, as a call after a drink writes it."""
    drink = CATALOG.drinks[drink_id]
    return [
        her("おいしい！", "好喝！", "happy"), producer("那就好。"),
        her(f"次は{drink.name_ja}。", f"下一杯要 {drink.name}。"),
    ]

PARTING = [her("ごちそうさま。", "多谢款待。"), producer("路上小心。")]
"""Her reaction to the last drink and her farewell."""


def events(res: httpx.Response) -> list[dict]:
    """The server-sent events of a response read to its end."""
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("text/event-stream")
    return [
        json.loads(line.removeprefix("data: "))
        for line in res.text.splitlines() if line.startswith("data: ")
    ]


async def enter(client: httpx.AsyncClient, **body: object) -> list[dict]:
    return events(await client.post(VISITS, json=body))


def mixed(drink_id: str, *, big: bool = False, karmotrine: int = 0) -> dict:
    """What the bar counter holds made as the drink's recipe has it, doubled if `big`, with
    `karmotrine` parts where the recipe leaves it optional."""
    recipe = CATALOG.drinks[drink_id].recipe
    assert recipe is not None
    times = 2 if big else 1
    return {
        "method": recipe.method, "adelhyde": recipe.adelhyde * times,
        "bronson_extract": recipe.bronson_extract * times,
        "powdered_delta": recipe.powdered_delta * times, "flanergide": recipe.flanergide * times,
        "karmotrine": karmotrine if recipe.karmotrine is None else recipe.karmotrine * times,
        "ice": recipe.ice, "aged": recipe.aged,
    }


def bottle(drink_id: str) -> dict:
    return {"method": "bottle", "bottle": drink_id}


async def serve(client: httpx.AsyncClient, visit_id: str, drink: dict) -> httpx.Response:
    return await client.post(f"{VISITS}/{visit_id}/serves", json=drink)


def kinds(evented: list[dict]) -> list[str]:
    return [e["type"] if e["type"] != "line" else f"line:{e['speaker']}" for e in evented]


async def test_a_visit_comes_in_orders_is_served_each_drink_and_says_goodbye(
    make_client: ClientFactory, settings: Settings
):
    llm = FakeLLM(["".join(COMING_IN)], reacting("sparkle-star"), PARTING)
    # Her reason, her topic, two drinks; Sugar Rush, a favorite, by name; on serving it, the
    # first fixed line, then a favorite again, which falls to her liking: Sparkle Star.
    client = make_client(llm, random=FakeRandom(0, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0))
    keep(settings.database_path, "producer", 70, datetime.now(UTC))  # close, were affinity on

    came_in = await enter(client)
    visit_id = came_in[0]["visit_id"]
    first = events(await serve(client, visit_id, mixed("sugar-rush")))
    last = events(await serve(client, visit_id, mixed("sparkle-star")))

    assert came_in[0] == {"type": "visit", "visit_id": visit_id, "character_id": "mano"}
    assert came_in[1:] == [
        {"type": "line", "speaker": "her", "emotion": "happy", "ja": "こんばんは。", "zh": "晚上好。"},
        {"type": "line", "speaker": "producer", "zh": "欢迎。"},
        {
            "type": "line", "speaker": "her", "emotion": "calm", "ja": "シュガーラッシュをください。",
            "zh": "请给我一杯 Sugar Rush。", "order": True,
        },
        {"type": "memo", "text": "她要 Sugar Rush。"},
        {"type": "waiting"},
    ]
    assert first[0] == {"type": "line", "speaker": "producer", "zh": "请慢用。"}
    assert kinds(first[1:]) == ["line:her", "line:producer", "line:her", "memo", "waiting"]
    assert first[3]["order"] is True  # her last line, none marked
    assert first[4] == {"type": "memo", "text": "她要 Sparkle Star。"}
    assert kinds(last) == ["line:producer", "line:her", "line:producer", "done"]
    assert last[-1] == {"type": "done", "rewarded": None}
    assert len(llm.prompts) == 3  # as many as the drinks, and one more
    assert llm.tools == [[], [], []]

    shared, about, *rest = llm.prompts[2]
    assert shared.role == "system" and shared.cache_breakpoint
    assert MANO_SHEET in shared.content and "VA-283" in shared.content
    assert about.role == "system" and not about.cache_breakpoint
    assert "比平时更近" not in about.content  # without the judge model, affinity is off
    assert [(m.role, m.cache_breakpoint) for m in rest] == [
        ("user", False), ("assistant", False), ("user", False), ("assistant", True),
        ("user", False),
    ]
    assert rest[1].content == "\n".join(COMING_IN)
    assert "Sparkle Star" in rest[2].content
    assert "告别" in rest[4].content
    assert llm.prompts[0][:2] == [shared, about]  # every call opens alike


async def streamed(
    client: httpx.AsyncClient,
    path: str,
    body: dict,
    *,
    until: str,
    gone: asyncio.Event | None = None,
    held: asyncio.Event | None = None,
) -> tuple[list[dict], asyncio.Task[None]]:
    """Post `body` to `path` and read its events as they come, until one of type `until`:
    those that came by then, which goes on growing, and the request going on, the page gone
    once `gone` is set, and the app held up sending that one till `held` is, if given.
    Driven as uvicorn drives the app, since httpx's ASGITransport would run it to the end
    first."""
    request = client.build_request("POST", path, json=body)
    scope = {
        "type": "http", "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1", "method": "POST", "scheme": "http", "path": request.url.path,
        "raw_path": request.url.raw_path, "query_string": b"",
        "headers": [(name.lower(), value) for name, value in request.headers.raw],
        "server": ("test", 80), "client": ("127.0.0.1", 50000), "root_path": "",
    }
    came: list[dict] = []
    arrived = asyncio.Event()
    sent = False

    async def receive() -> dict:
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": request.content, "more_body": False}
        await (gone or asyncio.Event()).wait()
        return {"type": "http.disconnect"}

    async def send(message: dict) -> None:
        for line in message.get("body", b"").decode().splitlines():
            if line.startswith("data: "):
                came.append(json.loads(line.removeprefix("data: ")))
                if came[-1]["type"] == until:
                    arrived.set()
                    if held is not None:
                        await held.wait()

    app = client._transport.app  # pyright: ignore[reportAttributeAccessIssue]
    task = asyncio.create_task(app(scope, receive, send))
    await asyncio.wait_for(arrived.wait(), timeout=5)
    return came, task


def refused(res: httpx.Response, status: int, code: str) -> None:
    assert res.status_code == status, res.text
    assert res.json()["code"] == code


async def test_only_the_users_visit_under_way_is_served_and_left(make_client: ClientFactory):
    llm = FakeLLM(COMING_IN, COMING_IN, COMING_IN)
    client = make_client(llm, random=FakeRandom(*[0, 0, 20, 0, 0, 0] * 3))
    friend = make_client(FakeLLM(), "friend")

    first = (await enter(client))[0]["visit_id"]
    second = (await enter(client))[0]["visit_id"]  # in another tab, say
    done_away_with = await serve(client, first, mixed("sugar-rush"))
    not_theirs = await serve(friend, second, mixed("sugar-rush"))
    not_theirs_to_leave = await friend.delete(f"{VISITS}/{second}")
    left = await client.delete(f"{VISITS}/{second}")
    after_leaving = await serve(client, second, mixed("sugar-rush"))
    leaving_again = await client.delete(f"{VISITS}/{second}")

    assert first != second
    refused(done_away_with, 410, "visit_gone")
    refused(not_theirs, 410, "visit_gone")
    refused(not_theirs_to_leave, 410, "visit_gone")
    assert left.status_code == 204
    refused(after_leaving, 410, "visit_gone")
    refused(leaving_again, 410, "visit_gone")


async def test_what_is_broken_is_refused_changing_nothing_and_a_bottle_is_served(
    make_client: ClientFactory,
):
    llm = FakeLLM(COMING_IN, PARTING)
    client = make_client(llm, random=FakeRandom(0, 0, 0, 0, 0, 0, 0))
    visit_id = (await enter(client))[0]["visit_id"]

    over_the_mixer = await serve(client, visit_id, {**mixed("sugar-rush"), "adelhyde": 21})
    no_recipe = await serve(client, visit_id, {**mixed("sugar-rush"), "ice": True})
    no_such_bottle = await serve(client, visit_id, bottle("sugar-rush"))
    unsaid = await client.post(f"{VISITS}/{visit_id}/serves", json={"method": "bottle"})
    served = events(await serve(client, visit_id, bottle("rum")))

    for res in (over_the_mixer, no_recipe, no_such_bottle):
        refused(res, 422, "broken_drink")
    assert unsaid.status_code == 422
    assert len(llm.prompts) == 2 and kinds(served)[-1] == "done"
    assert "Rum" in llm.prompts[1][-1].content  # served as it is


async def test_serving_while_her_lines_are_being_written_is_refused(make_client: ClientFactory):
    written = asyncio.Event()
    llm = FakeLLM([COMING_IN[0], written, *COMING_IN[1:]], PARTING)
    client = make_client(llm, random=FakeRandom(0, 0, 0, 0, 0, 0, 0))

    came, entering = await streamed(client, VISITS, {}, until="visit")
    too_soon = await serve(client, came[0]["visit_id"], mixed("sugar-rush"))
    written.set()
    await entering
    in_time = await serve(client, came[0]["visit_id"], mixed("sugar-rush"))

    refused(too_soon, 409, "not_waiting")
    assert kinds(came)[-2:] == ["memo", "waiting"]
    assert kinds(events(in_time))[-1] == "done"


async def test_closed_no_one_comes_in_but_a_visit_under_way_goes_on(
    make_client: ClientFactory, settings: Settings, github: FakeIdentityProvider
):
    llm = FakeLLM(COMING_IN, PARTING)
    client = make_client(
        llm, settings=replace(settings, admins=frozenset({ADMIN})),
        random=FakeRandom(0, 0, 0, 0, 0, 0, 0),
    )
    visit_id = (await enter(client))[0]["visit_id"]

    async with admin_beside(client, github) as admin:
        await admin.put("/api/admin/config/bar", json={"enabled": False})
        served = await serve(client, visit_id, mixed("sugar-rush"))
        closed = await client.post(VISITS, json={})

    assert kinds(events(served))[-1] == "done"
    refused(closed, 409, "bar_closed")
    assert len(llm.prompts) == 2


async def test_her_lines_are_read_as_forgivingly_as_they_can_be(make_client: ClientFactory):
    written = [
        "好的，下面是这一段：\n<her emo", 'tion="smug"><ja>ふふ。</ja></her>',
        "<her><zh>只有字幕</zh></her>", "<produ", "cer>来了。</producer>（她笑了）",
        "<producer><ja>どうぞ。</ja><zh>请。</zh></producer>", producer("それは光栄だ。"),
        producer("「ちゃんぽん」好吃吗？"), producer("晚上好，はづきさん。"),
        producer("書道、また本格的にやるの？"), her("シュガーラッシュで。", "就 Sugar Rush。"), "\n以上。",
    ]

    client = make_client(FakeLLM(written), random=FakeRandom(0, 0, 0, 0, 0, 0))

    came = await enter(client)

    assert came[1:] == [
        {"type": "line", "speaker": "her", "emotion": "calm", "ja": "ふふ。", "zh": "ふふ。"},
        {"type": "line", "speaker": "producer", "zh": "来了。"},
        {"type": "line", "speaker": "producer", "zh": "请。"},
        {"type": "line", "speaker": "producer", "zh": "「ちゃんぽん」好吃吗？"},
        {"type": "line", "speaker": "producer", "zh": "晚上好，はづきさん。"},
        {
            "type": "line", "speaker": "her", "emotion": "calm", "ja": "シュガーラッシュで。",
            "zh": "就 Sugar Rush。", "order": True,
        },
        {"type": "memo", "text": "她要 Sugar Rush。"},
        {"type": "waiting"},
    ]


async def test_every_call_tells_her_who_she_is_this_visit_what_came_before_and_what_to_write(
    make_client: ClientFactory, settings: Settings, characters: CharacterConfig
):
    write_world(characters, [("櫻木真乃", "illumination STARS", "関根瞳")])
    birthday = datetime(2026, 4, 25, 3, 0, tzinfo=UTC)  # hers, in Tokyo and Beijing
    llm = FakeLLM(COMING_IN, reacting("sparkle-star"), PARTING)
    client = make_client(
        llm, settings=replace(settings, judge=FAKE_JUDGE), clock=FakeClock(birthday),
        random=FakeRandom(0, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0),
    )
    await client.put("/api/profile", json={"form_of_address": "小林"})
    keep(settings.database_path, "producer", 70, birthday)  # close
    listed = load_bar_visits(characters.directory / BAR_VISITS_FILE)

    visit_id = (await enter(client))[0]["visit_id"]
    await serve(client, visit_id, mixed("sunshine-cloud"))  # bitter and girly: disliked
    await serve(client, visit_id, mixed("blue-fairy", big=True))  # sweet, but not her order

    shared, about, ask = (m.content for m in llm.prompts[0])
    assert MANO_SHEET in shared and "你的生日是4月25日。" in shared
    assert "illumination STARS" in shared  # the world setting
    assert "VA-283" in shared and "具体年龄" in shared and "不写露骨的情色内容" in shared
    assert "别人的生日和节日不用特意提" in shared
    assert "order=\"true\"" in shared and "一来一回" in shared
    assert "制作人的台词只用中文写" in shared
    assert "小林" in about
    reason, topic = listed.reasons[0], listed.topics[0]
    assert reason.note in about and topic.note in about
    assert f"进门时的心情：{MOODS[reason.mood]}" in about
    assert "打算喝 2 杯" in about
    assert "和制作人比平时更近" in about  # her tier
    assert "今天是你的生日" in about
    assert "这是你第一次来 VA-283" in about
    assert "喜欢的口味：甜" in about and "爱喝的：Sugar Rush" in about
    assert "讨厌的口味：苦" in about and "酒量：很能喝" in about
    assert "进门" in ask and "Sugar Rush" in ask and "シュガーラッシュ" in ask

    after_first, after_last = llm.prompts[1][-1].content, llm.prompts[2][-1].content
    assert "Sunshine Cloud（口味苦，种类女性化，不含酒精）" in after_first
    assert "判定：上错了" in after_first
    assert "Sparkle Star" in after_first  # her next order's card
    assert "Blue Fairy（口味甜，种类女性化，大杯，不含酒精）" in after_last
    assert "告别" in after_last
    for prompt in llm.prompts:
        assert "算对" not in prompt[-1].content and "上得最好" not in prompt[-1].content


async def test_a_visit_left_while_her_lines_are_being_written_is_written_no_further(
    make_client: ClientFactory,
):
    written = asyncio.Event()
    llm = FakeLLM([COMING_IN[0], written, *COMING_IN[1:]])
    client = make_client(llm, random=FakeRandom(0, 0, 0, 0, 0, 0))

    came, entering = await streamed(client, VISITS, {}, until="visit")
    left = await client.delete(f"{VISITS}/{came[0]['visit_id']}")
    written.set()
    await entering

    assert left.status_code == 204
    assert kinds(came) == ["visit"]

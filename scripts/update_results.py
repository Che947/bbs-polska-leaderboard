#!/usr/bin/env python3
"""Collect BBS Polska players' scores from Scarfire's finished Lichess team battles.

Uses only Python's standard library. Lichess endpoints stream NDJSON (one JSON
object per line), so this script deliberately handles the stream format.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "site" / "data" / "results.json"
CREATOR = os.environ.get("LICHESS_CREATOR", "Scarfire")
TEAM_ID = os.environ.get("LICHESS_TEAM_ID", "bbs-polska")
API_BASE = "https://lichess.org/api"
USER_AGENT = "BBS-Polska-Leaderboard/1.0 (GitHub Pages scheduled public-results collector)"
REQUEST_GAP_SECONDS = float(os.environ.get("LICHESS_REQUEST_GAP", "1.0"))
MAX_RETRIES = 5


def normalize_team(value: Any) -> str:
    """Normalize team ID/name for matching ID and display-name variants."""
    if not isinstance(value, str):
        return ""
    return re.sub(r"[^a-z0-9]", "", value.casefold())


def read_ndjson(url: str) -> list[dict[str, Any]]:
    """Fetch a Lichess NDJSON stream, retrying transient/rate-limit errors."""
    last_error: Exception | None = None
    for attempt in range(MAX_RETRIES):
        request = Request(
            url,
            headers={
                "Accept": "application/x-ndjson, application/json;q=0.9",
                "User-Agent": USER_AGENT,
            },
        )
        try:
            values: list[dict[str, Any]] = []
            with urlopen(request, timeout=90) as response:
                for raw_line in response:
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line:
                        continue
                    parsed = json.loads(line)
                    if isinstance(parsed, dict):
                        values.append(parsed)
            return values
        except HTTPError as exc:
            last_error = exc
            if exc.code not in (408, 425, 429, 500, 502, 503, 504):
                detail = exc.read().decode("utf-8", errors="replace")[:300]
                raise RuntimeError(f"Lichess zwrócił HTTP {exc.code} dla {url}: {detail}") from exc
            retry_after = exc.headers.get("Retry-After")
            try:
                wait = float(retry_after) if retry_after else min(2 ** attempt, 30)
            except ValueError:
                wait = min(2 ** attempt, 30)
            print(f"Przejściowy błąd HTTP {exc.code}; kolejna próba za {wait:g} s.", file=sys.stderr)
            time.sleep(wait)
        except (URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            last_error = exc
            wait = min(2 ** attempt, 30)
            print(f"Błąd pobierania danych ({exc}); kolejna próba za {wait} s.", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"Nie udało się pobrać danych z {url}: {last_error}")


def get_created_team_battles() -> list[dict[str, Any]]:
    """Fetch all tournaments created by Scarfire and keep finished BBS team battles."""
    creator = quote(CREATOR, safe="")
    # The API documents this endpoint as the full created-tournament stream;
    # omitting `nb` avoids imposing an artificial history cap.
    url = f"{API_BASE}/user/{creator}/tournament/created"
    print(f"Pobieram listę turniejów utworzonych przez {CREATOR}…")
    created = read_ndjson(url)
    wanted_team = normalize_team(TEAM_ID)
    battles = []
    for tournament in created:
        battle = tournament.get("teamBattle")
        if not isinstance(battle, dict):
            continue
        teams = battle.get("teams") or []
        if not any(normalize_team(team) == wanted_team for team in teams):
            continue
        if int(tournament.get("status", 0) or 0) != 30:
            # Results can change while an Arena is running, so only finished
            # battles are included in the historical ranking.
            continue
        if not tournament.get("id"):
            continue
        battles.append(tournament)
    battles.sort(key=lambda x: int(x.get("startsAt", 0) or 0))
    print(f"Znaleziono {len(battles)} ukończonych bitew z BBS Polska na liście drużyn (z {len(created)} turniejów Scarfire); ranking uwzględni tylko bitwy z faktycznym udziałem zawodników.")
    return battles


def collect_tournament_results(tournament: dict[str, Any]) -> tuple[list[dict[str, Any]], list[str]]:
    tournament_id = str(tournament["id"])
    url = f"{API_BASE}/tournament/{quote(tournament_id, safe='')}/results"
    raw_results = read_ndjson(url)
    accepted_team = normalize_team(TEAM_ID)
    accepted_name = normalize_team("BBS Polska")

    selected: list[dict[str, Any]] = []
    seen_usernames: set[str] = set()
    raw_teams: set[str] = set()
    missing_team_rows = 0

    for row in raw_results:
        team_value = row.get("team")
        if isinstance(team_value, str) and team_value:
            raw_teams.add(team_value)
        else:
            missing_team_rows += 1
        if normalize_team(team_value) not in {accepted_team, accepted_name}:
            continue
        username = row.get("username")
        if not isinstance(username, str) or not username:
            continue
        key = username.casefold()
        if key in seen_usernames:
            continue
        seen_usernames.add(key)
        selected.append({
            "username": username,
            "score": int(row.get("score", 0) or 0),
            "rank": int(row.get("rank", 0) or 0),
            "rating": int(row.get("rating", 0) or 0),
            "team": team_value,
        })

    warnings: list[str] = []
    if raw_results and not selected:
        if raw_teams:
            # The tournament list can include BBS Polska among invited teams
            # even when no Polish-team player actually participated. This is
            # expected for international team battles, not a data warning.
            # The caller omits such events from the BBS Polska history.
            return [], []
        # If rows no longer expose team identifiers at all, the API may have
        # changed shape. Fail safely rather than publish an incomplete ranking.
        raise RuntimeError(
            f"Nie rozpoznano zawodników BBS w bitwie {tournament_id}, a wyniki nie zawierają "
            "żadnych wartości pola team. Możliwa zmiana formatu API; nie nadpisuję danych."
        )
    if missing_team_rows:
        warnings.append(
            f"W bitwie {tournament_id} {missing_team_rows} wpisów z API nie miało pola team; "
            "do rankingu wliczono tylko jednoznacznie oznaczonych zawodników BBS Polska."
        )
    return selected, warnings


def build_dataset() -> dict[str, Any]:
    battles = get_created_team_battles()
    if not battles:
        raise RuntimeError(
            "Nie znaleziono ukończonych bitew utworzonych przez Scarfire z teamBattle.teams zawierającym "
            f"'{TEAM_ID}'. Sprawdź identyfikator klubu i konto twórcy; nie nadpisuję danych."
        )

    player_map: dict[str, dict[str, Any]] = {}
    tournament_rows: list[dict[str, Any]] = []
    warnings: list[str] = []
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

    for index, tournament in enumerate(battles):
        if index:
            time.sleep(REQUEST_GAP_SECONDS)
        tournament_id = str(tournament["id"])
        name = tournament.get("fullName") or tournament.get("name") or f"Bitwa {tournament_id}"
        starts_at = int(tournament.get("startsAt", 0) or 0)
        finishes_at = int(tournament.get("finishesAt", 0) or 0)
        print(f"[{index + 1}/{len(battles)}] {name} ({tournament_id})…")
        players, event_warnings = collect_tournament_results(tournament)
        if not players:
            print(f"  Pomijam — w tej bitwie nie było zawodników przypisanych do drużyny {TEAM_ID}.")
            continue
        warnings.extend(event_warnings)

        # Team-only place is based on descending battle scores; global Arena rank
        # remains available separately as `rank` for transparency.
        team_sorted = sorted(players, key=lambda p: (-p["score"], p["rank"] or 10**9, p["username"].casefold()))
        for team_position, player in enumerate(team_sorted, start=1):
            player["teamRank"] = team_position

        event_points = sum(p["score"] for p in players)
        tournament_rows.append({
            "id": tournament_id,
            "name": name,
            "startsAt": starts_at,
            "finishesAt": finishes_at,
            "status": int(tournament.get("status", 30) or 30),
            "nbPlayers": int(tournament.get("nbPlayers", 0) or 0),
            "bbsPlayerCount": len(players),
            "bbsPoints": event_points,
            "url": f"https://lichess.org/tournament/{quote(tournament_id, safe='')}",
        })

        for player in players:
            key = player["username"].casefold()
            if key not in player_map:
                player_map[key] = {"username": player["username"], "history": []}
            # Keep the most recently seen capitalization, without treating
            # different username capitalization as separate accounts.
            player_map[key]["username"] = player["username"]
            player_map[key]["history"].append({
                "tournamentId": tournament_id,
                "name": name,
                "startsAt": starts_at,
                "finishesAt": finishes_at,
                "score": player["score"],
                "rank": player["rank"],
                "teamRank": player["teamRank"],
                "rating": player["rating"],
                "url": f"https://lichess.org/tournament/{quote(tournament_id, safe='')}",
            })

    if not tournament_rows:
        raise RuntimeError(
            f"Nie znaleziono ukończonych bitew z rzeczywistym udziałem zawodników {TEAM_ID}; "
            "nie nadpisuję ostatnich poprawnych danych."
        )

    players_out = []
    participation_count = 0
    total_points = 0
    for player in player_map.values():
        history = sorted(player["history"], key=lambda x: x["startsAt"])
        total = sum(int(row["score"]) for row in history)
        count = len(history)
        best = max(history, key=lambda x: (int(x["score"]), -int(x["startsAt"]))) if history else None
        players_out.append({
            "username": player["username"],
            "points": total,
            "battles": count,
            "average": round(total / count, 2) if count else 0,
            "bestScore": int(best["score"]) if best else 0,
            "history": history,
        })
        participation_count += count
        total_points += total
    players_out.sort(key=lambda p: (-p["points"], -p["battles"], p["username"].casefold()))
    tournament_rows.sort(key=lambda t: t["startsAt"], reverse=True)

    # Remove duplicate warnings while retaining order.
    warnings = list(dict.fromkeys(warnings))
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": f"https://lichess.org/@/{quote(CREATOR, safe='')}/tournaments/created",
        "teamId": TEAM_ID,
        "creator": CREATOR,
        "summary": {
            "tournamentCount": len(tournament_rows),
            "playerCount": len(players_out),
            "participationCount": participation_count,
            "totalPoints": total_points,
            "firstBattleAt": min((t["startsAt"] for t in tournament_rows), default=None),
            "lastBattleAt": max((t["startsAt"] for t in tournament_rows), default=None),
        },
        "tournaments": tournament_rows,
        "players": players_out,
        "warnings": warnings,
        "error": None,
    }


def atomic_write(data: dict[str, Any]) -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    fd, temp_name = tempfile.mkstemp(prefix="results-", suffix=".json", dir=OUTPUT_PATH.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
        os.replace(temp_name, OUTPUT_PATH)
    finally:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass


def main() -> int:
    try:
        data = build_dataset()
        atomic_write(data)
        print(
            f"Zapisano {OUTPUT_PATH}: {data['summary']['tournamentCount']} bitew, "
            f"{data['summary']['playerCount']} zawodników, {data['summary']['totalPoints']} punktów."
        )
        if data.get("warnings"):
            print(f"Uwaga: {len(data['warnings'])} ostrzeżeń dot. pól danych. Sprawdź panel Actions.", file=sys.stderr)
        return 0
    except Exception as exc:  # keep the previous good JSON on every failed run
        print(f"BŁĄD AKTUALIZACJI: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

# BBS Polska — ranking bitew klubowych

Polskojęzyczna strona GitHub Pages z automatycznym rankingiem zawodników BBS Polska na podstawie ich indywidualnych punktów zdobytych w ukończonych bitwach klubowych na Lichess, utworzonych przez konto `Scarfire`.

## Co zawiera projekt

- responsywny ranking zawodników z wyszukiwarką;
- filtry roku i miesiąca oraz sortowanie według punktów, liczby bitew i średniej;
- klubowe podium i listę ostatnich bitew;
- skrypt pobierający turnieje i wyniki z publicznego API Lichess;
- GitHub Actions, który aktualizuje dane i publikuje stronę co 6 godzin, a także pozwala uruchomić synchronizację ręcznie.

## Jak uruchomić na GitHubie

1. Utwórz **publiczne repozytorium** na GitHubie, np. `bbs-polska-leaderboard`.
2. Wgraj całą zawartość tego katalogu do głównego katalogu repozytorium. Musi być w nim m.in. katalog `.github/workflows/`.
3. Otwórz repozytorium → **Settings → Pages**. W sekcji *Build and deployment* wybierz **Source: GitHub Actions**.
4. Otwórz **Settings → Actions → General → Workflow permissions** i upewnij się, że workflow może zapisywać zawartość repozytorium (*Read and write permissions*). Jeśli organizacja blokuje zapis tokenem `GITHUB_TOKEN`, administrator repozytorium musi zezwolić na taki zapis.
5. Wejdź w **Actions → BBS Polska — update and deploy → Run workflow** i uruchom pierwszą synchronizację.
6. Po zakończeniu zielonego workflow adres strony znajdziesz w **Settings → Pages** oraz w podsumowaniu zadania publikacji.

Przy kolejnym uruchomieniu strona automatycznie zaktualizuje dane przed publikacją. Harmonogram to `15 */6 * * *` (co 6 godzin, według czasu UTC). Lichess może chwilowo ograniczyć zapytania — skrypt ponawia próby dla przejściowych błędów i nie nadpisuje ostatniego poprawnego pliku, jeśli synchronizacja się nie uda.

## Jak liczone są punkty

1. Skrypt pobiera strumień turniejów utworzonych przez `Scarfire`.
2. Zostawia ukończone turnieje typu *team battle*, w których lista drużyn zawiera identyfikator `bbs-polska`.
3. Dla każdej bitwy pobiera strumień indywidualnych wyników i sumuje punkty graczy, których pole `team` w Lichess oznacza BBS Polska.
4. Buduje historię per zawodnik i zapisuje `site/data/results.json`. Strona przelicza ranking, filtry i statystyki po stronie przeglądarki.

Globalne miejsce w turnieju (pole `rank`) jest zachowane w danych historycznych; strona główna sortuje zawodników według sumy ich punktów z bitew BBS. Uwzględniane są wyłącznie ukończone bitwy, aby nie liczyć zmieniających się wyników turnieju w trakcie gry.

## Konfiguracja

Domyślne ustawienia:

- konto twórcy turniejów: `Scarfire`;
- identyfikator klubu Lichess: `bbs-polska`;
- harmonogram: co 6 godzin.

Skrypt pozwala nadpisać identyfikatory przez zmienne środowiskowe `LICHESS_CREATOR`, `LICHESS_TEAM_ID` oraz odstęp zapytań `LICHESS_REQUEST_GAP`.

## Lokalny podgląd

W katalogu głównym projektu uruchom:

```bash
python -m http.server 8000 --directory site
```

i otwórz `http://localhost:8000`.

## Diagnostyka

- Błąd aktualizacji widać w **Actions → ostatni run → Pobierz i przelicz wyniki z Lichess**.
- Jeśli API zmieni format odpowiedzi albo nie da się zidentyfikować pól `team`, skrypt kończy się błędem zamiast publikować pozornie poprawny, niepełny ranking.
- Pierwsza wersja `site/data/results.json` jest pusta. Zostanie zapełniona w pierwszym udanym uruchomieniu workflow.

## Źródła

- Profil twórcy turniejów: https://lichess.org/@/Scarfire/tournaments/created
- Klub: https://lichess.org/team/bbs-polska
- Dokumentacja API: https://lichess.org/api

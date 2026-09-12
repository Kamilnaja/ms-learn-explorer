# MS Learn Explorer

Rozszerzenie do Firefoksa, które dokleja na dole stron Microsoft Learn jeden przycisk: **Dalej**.

Wchodzisz sam na stronę kursu, np. <https://learn.microsoft.com/en-us/training/courses/dp-900t00>,
klikasz **Zacznij kurs** — i od tego momentu klikasz już tylko **Dalej**. Rozszerzenie prowadzi Cię
liniowo przez wszystkie lekcje: gdy moduł się kończy, samo przechodzi do następnego modułu, a gdy
kończy się ścieżka szkoleniowa — do następnej ścieżki. Nie musisz wracać do spisu treści.

Dla DP-900 to 63 lekcje w 9 modułach i 4 ścieżkach, przeklikiwane bez ani jednego powrotu do listy.

## Instalacja (tryb tymczasowy)

1. Otwórz w Firefoksie `about:debugging#/runtime/this-firefox`
2. **Wczytaj tymczasowy dodatek…**
3. Wskaż plik `manifest.json` z tego katalogu

Tak wczytany dodatek znika po restarcie przeglądarki. Żeby został na stałe, spakuj go
(`npm run build`) i zainstaluj `.zip` jako podpisany dodatek przez
[addons.mozilla.org](https://addons.mozilla.org/developers/) — Firefox nie instaluje na stałe
niepodpisanych rozszerzeń.

## Jak to działa

Pasek na dole pokazuje:

- etykietę kursu (`DP-900`), pozycję (`12 / 63`) i **procent ukończenia** wraz z paskiem postępu,
- tytuł następnej lekcji, jej moduł i czas trwania,
- przycisk **Dalej →**.

Z klawiatury: **`→`** przechodzi do następnej lekcji, **`←`** wraca do poprzedniej (działa też
`Alt` + `→`). Strzałki przejmujemy tylko wtedy, gdy nikt inny ich nie potrzebuje — gdy kursor stoi
w polu tekstowym, w grupie odpowiedzi testu wiedzy, na suwaku czy w innym widżecie, klawisz idzie
tam, gdzie powinien. Tak samo przy wciśniętym `Ctrl` lub `Shift`, oraz gdy nie ma dokąd iść (`←` na
pierwszej lekcji nie blokuje przewijania strony). Strzałki góra/dół zostają nietknięte.

Przycisk `▤` otwiera statystyki: procent, liczbę lekcji, ile minut materiału masz za sobą, ile
realnego czasu spędziłeś na stronach, kiedy ostatnio się uczyłeś oraz rozbicie postępu na moduły.
Przycisk `✕` zwija pasek do małej pigułki w rogu.

Ikona rozszerzenia na pasku narzędzi pokazuje listę zapisanych kursów z postępem i pozwala wskoczyć
w pierwszą nieprzerobioną lekcję.

Rozszerzenie działa na trzy sposoby w zależności od strony:

| Gdzie jesteś | Co robi pasek |
|---|---|
| strona kursu / ścieżki / modułu / lekcji bez planu | proponuje **Zacznij kurs** i buduje plan |
| lekcja należąca do planu | pokazuje postęp i prowadzi do następnej lekcji |
| strona spoza kursu | oferuje powrót do pierwszej nieprzerobionej lekcji |

Jeśli wejdziesz prosto na lekcję w środku kursu, pasek rozpozna pozycję (`41 / 63`) i poprowadzi
dalej od tego miejsca. Gdy dojdziesz do końca listy, a coś po drodze zostało pominięte, **Dalej**
zabierze Cię do zaległej lekcji; dopiero potem pokazuje „Kurs ukończony".

## Skąd bierze się plan kursu

Strony kursu, ścieżki i modułu renderują swoje listy dopiero w przeglądarce — w samym HTML-u nie ma
linków do lekcji, więc scrapowanie DOM-u jest zawodne. Plan budujemy z publicznego API hierarchii
Microsoft Learn, z którego korzysta sama strona:

- `/api/hierarchy/paths/<uid>?locale=xx-yy` → moduły ścieżki,
- `/api/hierarchy/modules/<uid>?locale=xx-yy` → lekcje modułu wraz z adresami i czasem trwania.

Identyfikatory ścieżek bierzemy ze znaczników `<meta name="learn_item">` na stronie kursu.

Gdy plan budujesz z lekcji, modułu albo ścieżki, celujemy **w cały kurs**, a nie w samą ścieżkę.
Ścieżka nie wie, do jakiego kursu należy, więc odwracamy mapowanie z katalogu Learn
(`/api/catalog/?type=courses`), gdzie pole `study_guide` wypisuje ścieżki każdego kursu. Bez tego
DP-900 rozpadał się na cztery niezależne plany po 13 lekcji zamiast jednego na 63.

Gdy jedna lekcja należy do kilku planów naraz, wygrywa plan najpełniejszy — kurs bije pojedynczą
ścieżkę. Przy przebudowie planu postęp z pozostałych planów jest przejmowany (jest kluczowany
adresem lekcji), więc rozszerzenie ścieżki do kursu nie kasuje tego, co już przerobione.
Zbudowanie planu DP-900 to 13 zapytań, wykonywanych raz — potem plan siedzi w pamięci rozszerzenia.
Plan odświeżysz przyciskiem **Odśwież plan kursu** w panelu statystyk.

## Prywatność

Wszystko — plan kursu, postęp i statystyki — leży w lokalnym magazynie rozszerzenia
(`browser.storage.local`) na Twoim komputerze. Nic nie jest nigdzie wysyłane, rozszerzenie nie
wymaga logowania i nie czyta Twojego konta Microsoft Learn. Postęp jest więc niezależny od tego,
co Learn odnotował po Twoim zalogowaniu: liczy się to, co faktycznie otworzyłeś z tym paskiem.

## Struktura

```
manifest.json      # MV3, uprawnienia: storage + learn.microsoft.com
src/core.js        # URL-e, API hierarchii Learn, storage, statystyki
src/content.js     # pasek „Dalej" wstrzykiwany w stronę (shadow DOM)
src/popup.html/js  # lista kursów pod ikoną rozszerzenia
icons/icon.svg
```

## Uwagi

`web-ext lint` przechodzi bez błędów. Zostają 4 ostrzeżenia `UNSAFE_VAR_ASSIGNMENT` o użyciu
`innerHTML` — wszystkie wstawiane wartości przechodzą przez funkcję `esc()`, więc to ostrzeżenie
kategorii, nie realny problem.

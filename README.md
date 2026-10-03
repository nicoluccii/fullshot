# Fullshot

Ein Klick auf das angepinnte Chrome-Symbol nimmt die gesamte scrollbare Webseite auf und kopiert sie als komprimiertes PNG in die Zwischenablage. Danach mit **Strg + V** einfügen. Die Aufnahme bleibt lokal; die Erweiterung enthält weder Serveraufrufe noch Analysecode.

## Installieren

1. In Chrome `chrome://extensions` öffnen und rechts oben den **Entwicklermodus** einschalten.
2. **Entpackte Erweiterung laden** wählen und diesen Ordner `Fullshot` auswählen.
3. Über das Erweiterungsmenü das Symbol von Fullshot an die Leiste anpinnen.

## Benutzen

Die gewünschte Webseite öffnen und einmal auf Fullshot klicken. Das kleine Fenster zeigt den Fortschritt und schließt sich nach erfolgreichem Kopieren. Während der Aufnahme den Tab nicht wechseln.

Fullshot behält die volle Bildauflösung. Vor dem PNG-Export rundet es jeden RGB-Farbkanal auf 32 Stufen. Das verändert einzelne Farbwerte geringfügig (höchstens 4 von 255), macht das PNG aber deutlich kleiner. Es ist daher **optisch sehr ähnlich, nicht bitgenau verlustfrei**. Das Fenster zeigt die Größe des erzeugten PNGs an; beim Einfügen kann Chrome das Bild nochmals kodieren.

Fullshot benötigt `activeTab` und `scripting`, um nach dem Klick die aktuelle Seite zu scrollen und die sichtbaren Ausschnitte aufzunehmen. `clipboardWrite` erlaubt das Kopieren des PNG. Es fordert keinen dauerhaften Zugriff auf alle Websites an.

## Grenzen des ersten Prototyps

- Chrome-eigene Seiten wie `chrome://` lassen sich nicht per Skript scrollen.
- Scrollbereiche *innerhalb* einer Webseite werden nicht zusätzlich aufgenommen.
- Sehr große Seiten sind auf 50 Millionen Bildpunkte begrenzt, damit der Browser nicht durch ein riesiges Bild überlastet wird.
- Dynamische Inhalte, Animationen und fest positionierte Elemente können an den Nahtstellen anders aussehen. Feststehende Kopfzeilen können in mehreren Ausschnitten erscheinen.

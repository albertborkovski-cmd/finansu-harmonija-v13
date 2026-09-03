# Finansų harmonija V12

Užfiksuota V12 testavimo versija. Tolesni pakeitimai atliekami atskirame V13 kataloge, V12 nebekeičiama.

## Testavimas internete

- Programa: https://albertborkovski-cmd.github.io/finansu-harmonija-v12/
- Kodas: https://github.com/albertborkovski-cmd/finansu-harmonija-v12
- Užfiksuotas leidimas: Git žyma `v12`.

Tai demonstracinis frontend prototipas, ne produkcinė apskaitos sistema. Prisijungimas tikrina įvedimo formatą, bet neatlieka tikro slaptažodžio patikrinimo. Galima įvesti testinį el. paštą ir bent 6 simbolių slaptažodį su didžiąja raide bei specialiuoju simboliu. Naujas el. paštas gauna peržiūros teises.

GitHub Pages versijos duomenys ir pakeitimai saugomi testuotojo naršyklėje. Skirtingi testuotojai nesidalija viena duomenų baze. Nekelkite tikrų konfidencialių dokumentų ir nenaudokite tikro slaptažodžio.

## Paleidimas

```bash
npm install
npm run dev -- --port 5193
```

Vietinis V12 adresas: <http://127.0.0.1:5193/>

V11 ir ankstesnės versijos lieka nepakeistos.

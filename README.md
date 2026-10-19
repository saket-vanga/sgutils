# SG Utils

Singapore on one map. Bus arrivals near you, rain radar, haze and UV, checkpoint traffic cams and bottle return machines.

An iPhone web app — open the site in Safari and add it to your Home Screen.

Everything runs on the phone. The feeds are public and allow browser calls, so the site is plain static files on GitHub Pages:

- Buses — [arrivelah](https://github.com/cheeaun/arrivelah) (LTA DataMall) and [busrouter.sg](https://busrouter.sg) stops
- Rain, PSI, PM2.5, UV, traffic cams — [data.gov.sg](https://data.gov.sg)
- Rain radar — weather.gov.sg
- Map — [OneMap](https://www.onemap.gov.sg) (Singapore Land Authority)
- Bottle return machines — `data/bcrs.json`, a snapshot of Return Right locations made by `update-bcrs.py` (their API blocks other sites, so the app ships a copy)

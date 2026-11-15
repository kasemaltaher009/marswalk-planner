# Ariadne — Marswalk Planner

NASA Space Apps Challenge 2026 — "Interplanetary Survival Guide: Martian Map" — Team Alien X (Mansoura, Egypt).

Ariadne combines NASA's Mars data into one map that plans the safest walking route to
science targets on Mount Sharp, Gale Crater, and shows the astronaut the time, risks and view
before they step outside.

## Data

All map data in `data/` is real NASA data, cropped and processed by our own script
(`prepare_data.py`): the USGS Gale 1 m elevation model and HiRISE colour mosaic, the THEMIS
thermal inertia mosaic, Curiosity's waypoints and drive path, REMS weather (PDS), and the Mars Trek
global mosaic. Curiosity photos load live from NASA's raw-image service. No data or images in this
app are AI-generated.

## Use of AI (Super Intelligence)

The project idea, the choice of site and science targets, and the safety rules (slope limits,
sand avoidance, 4-hour suit limit, radiation dose) were decided by the team.

We used Claude (Anthropic), an AI coding assistant, to help write and refactor the code in this
repository (the JavaScript web app and the Python data-preparation script) and to help find and
read NASA data documentation. Every part was reviewed, run and tested by the team, and the routing
code has unit tests (`node --test "tests/*.test.mjs"`).

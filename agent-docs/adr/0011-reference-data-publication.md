# ADR 0011: Reference data may be published

- Status: accepted
- Date: 2026-10-02
- Issue / PR: owner decision (Dinura), see the PR that adds this file
- Designathon departure: no

## Context

The Booklet's terms forbade sharing the datasets, and the spec kept the repository private until the organisers confirmed.

## Decision

The owner decided that the shared general reference files may be committed to the repository and seeded on the public deployment: outlets, vehicles, calendar, district travel, service allowance, traffic speed and road conditions, in `data/reference/`. Training and Test files, the peak-day scenario and fleet files, and organiser scripts remain out of the repository. All orders and history stay synthetic.

## Alternatives considered

- Wait for the organisers' reply: blocks seeding and fixtures.
- Hand-made substitute tables: lower accuracy and the Booklet worked examples would not match.

## Consequences

The repository no longer has to be private for data reasons. Spec edited: `platform/data-policy.md`.

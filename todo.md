### TODOS
#### Home
* create widgets to display at-a-glance info
* books read this year/book progress
* update sync statuses (todoist, caldav, database)

#### TODO

#### Calendar
* filter by local/calDav
* add local entries and add calendar database
* plan ahead - create goals

#### Exercise
* plan ahead - map out future exercises

#### Finance / Stocks
* future: drawdown / vs-SPY charts once the portfolio_value series (recording since 2026-08-07) has enough history

#### Finance / Bank
* tags v2 (merchant-level rules + editor shipped): per-transaction overrides — a `taggings` table for one-off adds ("this single Amazon charge is home") and rule exclusions ("this Netflix charge was a gift"); category-based rules; tag filters on Bank + the calendar cashflow filter; tag pills on transaction rows
* windowed Plaid re-link wipe: on INVALID_CURSOR delete only transaction rows inside the ~730-day re-send window instead of everything, so accumulated history older than the window survives a re-link
* recurring series extras: project upcoming confirmed charges onto future calendar days, overdue/price-hike surfacing, per-series edit (amount/cadence)
* periodic export of the events table as a backstop (free-tier DB restore window is short)

#### Projects
* track projects

#### Reading
* add series to schema
* replace status with emojies/symbols
# PonsEye rug protection backtest notes

## Baseline

Recorded on 13 September 2026 using a fixed cutoff of 11:25:56 UTC so new acquisitions could not change the comparison while it ran.

The test contained 95 acquired positions using `strict-quiet-staggered-v1`:

* 20% sold at 10x
* 20% sold at 20x
* 50% sold at 50x
* 10% sold at 100x
* No stop loss
* $25 initial position

The baseline marked profit was $1,377.28 before fees and slippage.

## Current leading protection candidates

### Five minute failure exit

Exit a position when it is still below its entry price five minutes after acquisition, provided it has not already reached 10x.

Results:

* 49 of 95 positions exited
* Profit improved by $241.88
* No recorded 10x runners were removed
* 12 September improved by $198.08
* 13 September improved by $43.82

This performed better than immediate fixed stops. Several eventual runners dipped substantially before recovering, so early stops removed valuable runners.

### Partial stage floor protection

After a profit stage is reached, create a loose floor at 25% of the highest completed stage. If the floor is crossed, sell half of the remaining position and leave the other half on the original stage plan.

Examples:

* After 10x, the floor is 2.5x
* After 20x, the floor is 5x
* After 50x, the floor is 12.5x

Across the nine positions that reached 10x by the cutoff:

* Profit improved by $272.75
* Eight positions improved
* One position was worse
* Half of every remaining runner was preserved

For BERRY, the existing model showed approximately $32.23 profit. The partial stage floor model showed approximately $44.26 profit, saving about $12 while leaving 40% of the original token quantity open.

Selling the entire remaining position at the same floor improved the nine runner group by $545.51 and would have produced approximately $56.28 profit on BERRY. It also completely removed one token before it later reached 100x, so it is not the preferred balanced version.

## Signals checked

Price position after acquisition was the strongest early warning in this batch.

Tokens that finished below half of entry had weaker buy pressure and substantially lower trade activity after five minutes than the 10x runners. Adding a buy pressure condition did not improve the five minute price rule.

Holder snapshots were not useful because the recorded values barely changed during the five minute comparison window.

## Tests to run next

1. Refine the failure timer across three, four, five, six, eight and ten minutes.
2. Require price to remain below entry continuously for 30, 60 or 90 seconds before exiting.
3. Test failed bounce rules, including a lower high followed by a break of the local low.
4. Test rolling sell pressure using both trade count and dollar value over the latest 10, 20 and 30 trades.
5. Test sudden activity decay, such as trades per 30 seconds falling by 50%, 70% or 90%.
6. Track early buyer and creator wallet exits to see whether their selling precedes the collapse.
7. Compare selling 25%, 50%, 75% or 100% of the remaining position when a stage floor is crossed.
8. Test stage floors at 20%, 25%, 30%, 40% and 50% of the highest completed stage.
9. Test a time limit after 10x when the next stage is not reached and price has also weakened.
10. Test migration delays and missing post migration liquidity as a separate risk signal.
11. Apply next trade fills, fees, slippage and failed fill assumptions to every candidate.
12. Validate leading rules on fresh batches and on each day separately before changing the live exit model.

## Decision

Do not change the live rules from this result alone. Keep the five minute failure exit and partial stage floor protection as the leading candidates for the next full backtest.

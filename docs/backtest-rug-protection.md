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

The refreshed baseline marked profit was $1,395.59 before fees and slippage.

## Confirmed individual test leaders

Each result below was tested separately on top of the unchanged live entry and exit rules. Candidate protection rules were not combined.

### Early buyer wallet exit

The original wallet test incorrectly excluded official pool sales after migration. It was rerun using curve sales before migration and official launch pool sales after migration.

Corrected results:

* The 80% version reduced profit by $695.20 and removed three recorded 10x runners
* The 90% version improved profit by $37.53 but removed one recorded 10x runner
* The 95% version improved profit by $16.97 without removing a recorded 5x or 10x runner
* The 100% version never triggered

The early buyer wallet exit is rejected. The safe version adds too little profit and the lower thresholds remove important runners.

### Eight minute failure exit

Exit on the first fillable trade after eight minutes when the position is still below entry and has not reached 10x.

Refreshed results after the stored price history had caught up:

* 48 of 95 positions exited
* Profit improved by $152.15
* No recorded 10x runners were removed
* Four later 5x runners were removed

Recorded sell costs left the improvement at $148.90. Adding 5% exit slippage left $141.29 and adding 10% exit slippage left $133.69.

This remains the leading pre 10x protection candidate after the corrected wallet test was rejected.

## Test 7: partial stage floor protection

After a profit stage is reached, create a loose floor at 25% of the highest completed stage. If the floor is crossed, sell half of the remaining position and leave the other half on the original stage plan.

Examples:

* After 10x, the floor is 2.5x
* After 20x, the floor is 5x
* After 50x, the floor is 12.5x

The corrected test used the first real recorded price after each floor crossing instead of assuming a fill exactly at the floor.

Results across the nine positions that reached 10x:

* Selling 25% of the remainder improved profit by $5.80
* Selling 50% improved profit by $11.59
* Selling 75% improved profit by $17.39
* Selling 100% improved profit by $23.19, but fully removed PAIREX before it later reached 100x

The 50% version saved $12.02 on BERRY but lost $117.71 on PAIREX because the first recorded fill after its 12.5x floor broke was only 5.83x. This test is not a leading candidate once realistic fills are used.

## Test 8: stage floor level

This test held the protection sale at 50% of the remaining position and changed only the floor level. Each version was tested separately on top of the unchanged live rules using the first real recorded fill after the floor crossing.

Results:

* 20% floor reduced profit by $19.82
* 25% floor improved profit by $11.59
* 30% floor reduced profit by $222.36
* 40% floor reduced profit by $173.95
* 50% floor reduced profit by $99.64

All five versions reduced PAIREX exposure before it later reached 100x. Floors of 30% or higher triggered after PAIREX reached 20x but before it reached 50x, causing particularly large lost returns. The 25% floor was the only positive version, but its $11.59 improvement is too small for the runner risk. No stage floor level is currently recommended.

## Test 9: time and weakness after 10x

This test kept the existing 20% sale at 10x. If 20x had not been reached, it waited for a chosen time and then sold the remaining 80% when the recorded price fell below the chosen weakness level. Waiting periods from one to 60 minutes and weakness levels from 1x to 10x were tested separately using real recorded fills.

The best balanced version was:

* Wait at least three minutes after reaching 10x
* Do nothing if 20x is reached
* Otherwise sell the remaining 80% on the first real fill below 3x
* Profit improved by $161.00
* No later 20x, 50x or 100x runner was removed

It exited three positions:

* MIMI at 2.98x, improving profit by $56.59
* WikiPad at 2.94x, improving profit by $52.63
* BERRY at 2.95x, improving profit by $51.78

This is the leading individual post 10x protection rule. It improved total marked profit from $1,395.59 to $1,556.59.

## Test 11: fees, slippage and failed fills

Recorded curve trades for the acquired set showed average costs of 2.128% on buys and 2.136% on sells. The stress test applied those costs to both the live baseline and the leading post 10x protection rule. It also included an illustrative $0.05 network cost for 207 buy and sell transactions across the batch.

Results:

* Recorded fees with no extra slippage left the protection rule $154.21 ahead of the baseline
* Recorded fees plus 2% slippage on each side left it $148.10 ahead
* Recorded fees plus 5% slippage on each side left it $139.17 ahead
* Recorded fees plus 10% slippage on each side left it $124.91 ahead

Retry delays were tested using the first real recorded price after the delayed retry. With a five second retry delay, the gross improvement remained $121.66. After the recorded sell cost and an additional 10% exit slippage, it still improved profit by $106.89.

The post 10x protection rule remains worthwhile under all tested fee, slippage and delayed fill assumptions.

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

The combined replay improved gross profit from $1,395.59 to $1,708.74, an improvement of $313.15. With recorded sell costs and 10% additional exit slippage, the improvement remained $275.15. It closed 48 positions through the eight minute rule and three through the post 10x rule, without removing a future 10x runner.

The untouched batch collected after the fixed cutoff contained 12 mature positions. The eight minute rule closed six, improved gross profit by $6.41 and removed no later 5x or 10x runner. None reached 10x, so this batch validates only the early rule.

Immediately before activation, the complete 107 position path was replayed through all price data collected before the recorder paused. It improved marked gross profit from $1,228.35 to $1,571.07, a gain of $342.73. It produced 58 eight minute exits and five post 10x exits. Three early exits later touched 5x, but no protected position later reached 10x or 20x.

Activate both tested protections with the existing Strict Quiet entry and staged exits. Early wallet exits and stage floor rules remain rejected.

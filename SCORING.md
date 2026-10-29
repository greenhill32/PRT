# PRT Scoring Tables & Algorithm

**Source:** US Navy PRT-inspired scoring, personal fitness app (not official Navy assessment)

**Standard:** Navy 55–59 male thresholds
- Sex: Male
- Age band: 55–59
- Events: Push-ups, forearm plank, 2 km row
- Altitude: under 5,000 ft

## Official Threshold Tables

| Score | Push-ups (reps) | Plank (mm:ss) | 2 km row (mm:ss) |
|------:|----------------:|---------------:|------------------:|
| 100   | 60              | 2:54           | 7:40              |
| 95    | 59              | 2:49           | 7:50              |
| 90    | 56              | 2:45           | 8:00              |
| 85    | 52              | 2:36           | 8:10              |
| 80    | 48              | 2:28           | 8:20              |
| 75    | 46              | 2:19           | 8:30              |
| 70    | 38              | 2:02           | 8:50              |
| 65    | 32              | 1:44           | 9:10              |
| 60    | 16              | 1:27           | 9:30              |

## Scoring Rules

1. **Event scoring:** For each event, compare raw value against the thresholds
2. **Interpolation:** Between official thresholds, interpolate smoothly (not discrete 5-point jumps)
3. **Ceiling:** Cap each event score at 100
4. **Floor:** Below 60-point threshold, score is 0 (or continue interpolating down?)
5. **Composite score:** Arithmetic mean of the three event scores
   ```
   overallScore = round((pushupScore + plankScore + plankScore) / 3)
   ```

## Navy-Style Categories

Map the overall score to Navy categories:
- **100:** Outstanding
- **85–99:** Excellent
- **70–84:** Good
- **60–69:** Satisfactory
- **< 60:** Does Not Meet Standards

## Example Calculation

Raw results:
- Push-ups: 38 reps → 70 points
- Plank: 2:02 → 70 points
- 2 km row: 8:50 → 70 points
- Overall Score: (70 + 70 + 70) / 3 = 70 → "Good"

## Leaderboard Logic

- Leaderboard is sorted by overall score (arithmetic mean)
- Do NOT use "lowest event wins"
- Reward overall performance across all three events
- Rivals are scored using the exact same algorithm as the user

## Implementation Notes

- Interpolation should be linear between adjacent thresholds
- Push-ups are bounded at 0 (can't score negative)
- Plank and row times: lower is better (inverse relationship)
- The scoring module is the single source of truth for point calculation
- Same module used by both client (for instant feedback) and Edge Function (authoritative)

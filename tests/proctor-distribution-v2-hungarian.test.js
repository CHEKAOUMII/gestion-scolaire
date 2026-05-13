/**
 * Unit tests for proctor-distribution-v2.js — Task 3.1 hungarianSolver
 * Tests: Hungarian/Munkres O(n³) algorithm correctness, edge cases, error handling
 */
const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

// Load the module in a simulated browser context
const source = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'algorithms', 'proctor-distribution-v2.js'),
  'utf8'
);

const sandbox = { window: {}, Math, console, Infinity, isFinite, isNaN, Set, Object, Array, String, Number, Error, Date, TypeError, NaN };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const internals = sandbox.window.ProctorDistributionV2._internals;
const hungarianSolver = internals.hungarianSolver;

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log('  [pass] ' + name);
    passed++;
  } catch (e) {
    console.log('  [FAIL] ' + name + ': ' + e.message);
    failed++;
  }
}

/**
 * Brute-force optimal assignment for small matrices (n <= 8).
 * Used to verify Hungarian results.
 */
function bruteForceOptimal(cost) {
  const n = cost.length;
  if (n === 0) return { assignment: [], totalCost: 0 };

  const perm = Array.from({ length: n }, (_, i) => i);
  let bestCost = Infinity;
  let bestPerm = null;

  function permute(arr, l) {
    if (l === n) {
      let total = 0;
      for (let i = 0; i < n; i++) {
        total += cost[i][arr[i]];
      }
      if (total < bestCost) {
        bestCost = total;
        bestPerm = arr.slice();
      }
      return;
    }
    for (let i = l; i < n; i++) {
      [arr[l], arr[i]] = [arr[i], arr[l]];
      permute(arr, l + 1);
      [arr[l], arr[i]] = [arr[i], arr[l]];
    }
  }

  permute(perm, 0);
  return { assignment: bestPerm, totalCost: bestCost };
}

console.log('[test] hungarianSolver (Task 3.1)');

// === Edge Cases ===

runTest('empty matrix returns empty array', function () {
  const result = hungarianSolver([]);
  assert.strictEqual(result.length, 0);
});

runTest('1x1 matrix returns [0]', function () {
  const result = hungarianSolver([[42]]);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0], 0);
});

runTest('1x1 matrix with zero cost', function () {
  const result = hungarianSolver([[0]]);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0], 0);
});

// === 2x2 Cases ===

runTest('2x2 diagonal optimal', function () {
  const result = hungarianSolver([[1, 100], [100, 1]]);
  assert.strictEqual(result[0], 0);
  assert.strictEqual(result[1], 1);
});

runTest('2x2 anti-diagonal optimal', function () {
  const result = hungarianSolver([[100, 1], [1, 100]]);
  assert.strictEqual(result[0], 1);
  assert.strictEqual(result[1], 0);
});

runTest('2x2 equal costs', function () {
  const result = hungarianSolver([[5, 5], [5, 5]]);
  // Any valid assignment is optimal
  assert.strictEqual(result.length, 2);
  assert.notStrictEqual(result[0], result[1]);
});

// === 3x3 Cases ===

runTest('3x3 known optimal (cost=12)', function () {
  const cost = [
    [10, 5, 13],
    [3, 7, 2],
    [6, 8, 4]
  ];
  const result = hungarianSolver(cost);
  const total = cost[0][result[0]] + cost[1][result[1]] + cost[2][result[2]];
  assert.strictEqual(total, 12);
});

runTest('3x3 identity-like matrix', function () {
  const cost = [
    [0, 100, 100],
    [100, 0, 100],
    [100, 100, 0]
  ];
  const result = hungarianSolver(cost);
  assert.deepStrictEqual(result, [0, 1, 2]);
});

// === 4x4 Cases ===

runTest('4x4 known optimal (cost=140)', function () {
  const cost = [
    [82, 83, 69, 92],
    [77, 37, 49, 92],
    [11, 69, 5, 86],
    [8, 9, 98, 23]
  ];
  const result = hungarianSolver(cost);
  const total = cost[0][result[0]] + cost[1][result[1]] + cost[2][result[2]] + cost[3][result[3]];
  assert.strictEqual(total, 140);
});

// === Optimality Verification (brute force comparison) ===

runTest('5x5 random matrix matches brute-force optimal', function () {
  const cost = [
    [7, 2, 1, 9, 4],
    [9, 6, 9, 5, 5],
    [3, 8, 3, 1, 8],
    [7, 9, 4, 2, 2],
    [8, 4, 7, 4, 8]
  ];
  const result = hungarianSolver(cost);
  let total = 0;
  for (let i = 0; i < 5; i++) total += cost[i][result[i]];

  const bf = bruteForceOptimal(cost);
  assert.strictEqual(total, bf.totalCost, 'Hungarian cost ' + total + ' != brute force ' + bf.totalCost);
});

runTest('6x6 random matrix matches brute-force optimal', function () {
  const cost = [
    [12, 7, 9, 7, 9, 8],
    [8, 9, 6, 6, 6, 5],
    [7, 17, 12, 14, 9, 11],
    [15, 14, 6, 6, 10, 8],
    [4, 10, 7, 10, 9, 11],
    [10, 6, 9, 4, 10, 7]
  ];
  const result = hungarianSolver(cost);
  let total = 0;
  for (let i = 0; i < 6; i++) total += cost[i][result[i]];

  const bf = bruteForceOptimal(cost);
  assert.strictEqual(total, bf.totalCost, 'Hungarian cost ' + total + ' != brute force ' + bf.totalCost);
});

// === Large Sentinel Values (simulating INFINITY_SENTINEL = 1e9) ===

runTest('handles 1e9 sentinel values correctly', function () {
  const cost = [
    [1e9, 1, 1e9],
    [1e9, 1e9, 2],
    [3, 1e9, 1e9]
  ];
  const result = hungarianSolver(cost);
  assert.strictEqual(result[0], 1);
  assert.strictEqual(result[1], 2);
  assert.strictEqual(result[2], 0);
});

runTest('matrix with mixed sentinel and normal values', function () {
  const cost = [
    [1e9, 5, 1e9, 1e9],
    [1e9, 1e9, 3, 1e9],
    [1e9, 1e9, 1e9, 7],
    [2, 1e9, 1e9, 1e9]
  ];
  const result = hungarianSolver(cost);
  const total = cost[0][result[0]] + cost[1][result[1]] + cost[2][result[2]] + cost[3][result[3]];
  assert.strictEqual(total, 17); // 5+3+7+2
});

// === Valid Assignment Properties ===

runTest('result is a valid permutation (no duplicate columns)', function () {
  const cost = [
    [5, 9, 1],
    [10, 3, 2],
    [8, 7, 4]
  ];
  const result = hungarianSolver(cost);
  const sorted = result.slice().sort();
  assert.deepStrictEqual(sorted, [0, 1, 2]);
});

runTest('result length equals matrix size', function () {
  const n = 7;
  const cost = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 100))
  );
  const result = hungarianSolver(cost);
  assert.strictEqual(result.length, n);
  // Check it's a valid permutation
  const sorted = result.slice().sort((a, b) => a - b);
  for (let i = 0; i < n; i++) {
    assert.strictEqual(sorted[i], i);
  }
});

// === Zero Cost Matrix ===

runTest('all-zero cost matrix returns valid assignment', function () {
  const cost = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];
  const result = hungarianSolver(cost);
  assert.strictEqual(result.length, 3);
  const sorted = result.slice().sort();
  assert.deepStrictEqual(sorted, [0, 1, 2]);
});

// === Hungarian ≤ Greedy (pick min per row) ===

runTest('Hungarian total cost <= greedy row-minimum total cost', function () {
  // Greedy strategy: for each row, pick the column with minimum cost (ignoring conflicts)
  // This can produce invalid assignments (duplicate columns), but the total cost
  // represents a lower bound on what a naive greedy would achieve.
  // However, a valid greedy picks min available column per row in order.
  const cost = [
    [10, 5, 13],
    [3, 7, 2],
    [6, 8, 4]
  ];

  // Hungarian assignment
  const hungarianResult = hungarianSolver(cost);
  let hungarianCost = 0;
  for (let i = 0; i < cost.length; i++) {
    hungarianCost += cost[i][hungarianResult[i]];
  }

  // Greedy: for each row in order, pick the minimum-cost available column
  function greedyAssignment(matrix) {
    const n = matrix.length;
    const usedCols = new Set();
    const assignment = new Array(n);
    for (let i = 0; i < n; i++) {
      let bestCol = -1;
      let bestCost = Infinity;
      for (let j = 0; j < n; j++) {
        if (!usedCols.has(j) && matrix[i][j] < bestCost) {
          bestCost = matrix[i][j];
          bestCol = j;
        }
      }
      assignment[i] = bestCol;
      usedCols.add(bestCol);
    }
    return assignment;
  }

  const greedyResult = greedyAssignment(cost);
  let greedyCost = 0;
  for (let i = 0; i < cost.length; i++) {
    greedyCost += cost[i][greedyResult[i]];
  }

  assert.ok(hungarianCost <= greedyCost,
    'Hungarian cost (' + hungarianCost + ') should be <= greedy cost (' + greedyCost + ')');
});

runTest('Hungarian <= greedy on larger matrix with sentinel values', function () {
  const cost = [
    [1e9, 3, 1e9, 8],
    [5, 1e9, 2, 1e9],
    [1e9, 7, 1e9, 1],
    [4, 1e9, 6, 1e9]
  ];

  const hungarianResult = hungarianSolver(cost);
  let hungarianCost = 0;
  for (let i = 0; i < cost.length; i++) {
    hungarianCost += cost[i][hungarianResult[i]];
  }

  // Greedy: for each row in order, pick the minimum-cost available column
  const n = cost.length;
  const usedCols = new Set();
  const greedyAssign = new Array(n);
  for (let i = 0; i < n; i++) {
    let bestCol = -1;
    let bestCost = Infinity;
    for (let j = 0; j < n; j++) {
      if (!usedCols.has(j) && cost[i][j] < bestCost) {
        bestCost = cost[i][j];
        bestCol = j;
      }
    }
    greedyAssign[i] = bestCol;
    usedCols.add(bestCol);
  }
  let greedyCost = 0;
  for (let i = 0; i < n; i++) {
    greedyCost += cost[i][greedyAssign[i]];
  }

  assert.ok(hungarianCost <= greedyCost,
    'Hungarian cost (' + hungarianCost + ') should be <= greedy cost (' + greedyCost + ')');
});

// === Error Handling ===

runTest('throws on non-square matrix (more cols)', function () {
  assert.throws(function () {
    hungarianSolver([[1, 2, 3], [4, 5, 6]]);
  }, /not square/);
});

runTest('throws on non-square matrix (fewer cols in one row)', function () {
  assert.throws(function () {
    hungarianSolver([[1, 2], [3, 4, 5]]);
  }, /not square/);
});

runTest('throws on NaN value', function () {
  assert.throws(function () {
    hungarianSolver([[1, NaN], [3, 4]]);
  }, /invalid value/);
});

runTest('throws on non-array row', function () {
  assert.throws(function () {
    hungarianSolver([[1, 2], 'not an array']);
  }, /not an array/);
});

runTest('throws on undefined value', function () {
  assert.throws(function () {
    hungarianSolver([[1, undefined], [3, 4]]);
  }, /invalid value/);
});

// === Summary ===

console.log('\n[test] hungarianSolver: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  process.exit(1);
}

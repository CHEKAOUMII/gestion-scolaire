'use strict';

// node tests/import-center/import-orchestrator-graph.test.js

const assert = require('assert');
const Orch = require('../../js/import-center/import-orchestrator.js');
const { ImportSession } = require('../../js/import-center/import-session.js');

function makeReadyItem(session, name, type, deps) {
    const [item] = session.addFiles([{ name, size: 1 }]);
    item.status = 'ready';
    item.selectedType = type;
    item.detectedType = type;
    item.dependencies = deps || [];
    item.preflight = {
        valid: true,
        executable: true,
        decisionVersion: 0,
        selectedType: type,
        dependencies: deps || []
    };
    item._prepared = {
        type,
        preflight: item.preflight,
        executionPayload: { rows: [{ code: 'S1' }], notPersisted: true },
        sourceFileId: item.id
    };
    return item;
}

const session = ImportSession.create({ expectedYear: '2026-2027' });
const students = makeReadyItem(session, 's.csv', 'students', []);
const grades = makeReadyItem(session, 'g.csv', 'grades', [
    { sourceType: 'students', reason: 'النقط تعتمد على التلاميذ', required: true, satisfied: false, targetFileId: null }
]);
const absences = makeReadyItem(session, 'a.csv', 'absences', [
    { sourceType: 'students', reason: 'الغياب يعتمد على التلاميذ', required: true, satisfied: false }
]);
// Unrelated type without edge among them beyond students
const review = makeReadyItem(session, 'r.csv', 'fet', []);
review.status = 'needs_review';

const ids = [students.id, grades.id, absences.id, review.id];
const graph = Orch.buildDependencyGraph(session, ids, {});
assert.ok(graph.edges.some((e) => e.from === students.id && e.to === grades.id));
assert.ok(graph.edges.some((e) => e.from === students.id && e.to === absences.id));
assert.ok(graph.blockedAtStart.includes(review.id));
assert.ok(graph.reasons[review.id]);

const { order, blocked, waitReasons } = Orch.topologicalOrder(graph, session);
assert.ok(order.indexOf(students.id) < order.indexOf(grades.id), 'students before grades');
assert.ok(order.indexOf(students.id) < order.indexOf(absences.id), 'students before absences');
assert.ok(!order.includes(review.id), 'needs_review not in order');
assert.ok(blocked.some((b) => b.fileId === review.id));
assert.ok(waitReasons[grades.id] || graph.edges.some((e) => e.to === grades.id && e.reason));

// Missing required dependency blocks start
const session2 = ImportSession.create();
const onlyGrades = makeReadyItem(session2, 'only-g.csv', 'grades', [
    { sourceType: 'students', reason: 'يحتاج تلاميذ', required: true, satisfied: false }
]);
const g2 = Orch.buildDependencyGraph(session2, [onlyGrades.id], {});
assert.ok(g2.blockedAtStart.includes(onlyGrades.id));
assert.ok(/تلاميذ|students|اعتماد/i.test(g2.reasons[onlyGrades.id]));

// Readiness can satisfy dependency without file
const session3 = ImportSession.create();
const g3item = makeReadyItem(session3, 'g3.csv', 'grades', [
    { sourceType: 'students', reason: 'يحتاج تلاميذ', required: true, satisfied: false }
]);
const g3 = Orch.buildDependencyGraph(session3, [g3item.id], { sourceReadiness: { students: true } });
assert.ok(!g3.blockedAtStart.includes(g3item.id));

console.log('import-orchestrator-graph: OK');

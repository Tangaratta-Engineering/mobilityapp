'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const swaggerUi = require('swagger-ui-express');

// --- Firebase Admin Init ---
let serviceAccount;
try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '');
} catch {
    console.error('FIREBASE_SERVICE_ACCOUNT env var is missing or not valid JSON');
    process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// --- Config ---
const USER_ID = process.env.USER_ID;
const API_KEY = process.env.API_KEY;
const PORT = process.env.PORT || 3001;

if (!USER_ID) {
    console.error('USER_ID env var is required');
    process.exit(1);
}

// --- Express Setup ---
const app = express();
app.use(cors());
app.use(express.json());

// --- Auth Middleware ---
function requireApiKey(req, res, next) {
    if (!API_KEY) return next(); // no key set = open (dev only)
    if (req.headers['x-api-key'] !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized — provide a valid x-api-key header' });
    }
    next();
}

// --- Firestore Helpers ---
const exercisesRef = () => db.collection(`users/${USER_ID}/exercises`);
const logsRef = () => db.collection(`users/${USER_ID}/logs`);
const toObj = (doc) => ({ id: doc.id, ...doc.data() });

// ============================================================
// EXERCISE ROUTES
// ============================================================

// GET /exercises
app.get('/exercises', requireApiKey, async (req, res) => {
    try {
        const snap = await exercisesRef().orderBy('order').get();
        res.json(snap.docs.map(toObj));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /exercises
app.post('/exercises', requireApiKey, async (req, res) => {
    try {
        const { Name, Focus_Area, Target_Sets, Target_Reps, Weight_Used_Initial, Video_Link, Physio_Notes, order } = req.body;
        if (!Name) return res.status(400).json({ error: 'Name is required' });
        const data = { Name, Focus_Area: Focus_Area ?? '', Target_Sets: Target_Sets ?? null, Target_Reps: Target_Reps ?? null, Weight_Used_Initial: Weight_Used_Initial ?? null, Video_Link: Video_Link ?? '', Physio_Notes: Physio_Notes ?? '', order: order ?? 0 };
        const ref = await exercisesRef().add(data);
        res.status(201).json({ id: ref.id, ...data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /exercises/:id
app.get('/exercises/:id', requireApiKey, async (req, res) => {
    try {
        const doc = await exercisesRef().doc(req.params.id).get();
        if (!doc.exists) return res.status(404).json({ error: 'Exercise not found' });
        res.json(toObj(doc));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /exercises/:id
app.put('/exercises/:id', requireApiKey, async (req, res) => {
    try {
        const ref = exercisesRef().doc(req.params.id);
        const doc = await ref.get();
        if (!doc.exists) return res.status(404).json({ error: 'Exercise not found' });
        const fields = ['Name', 'Focus_Area', 'Target_Sets', 'Target_Reps', 'Weight_Used_Initial', 'Video_Link', 'Physio_Notes', 'order'];
        const update = {};
        for (const f of fields) {
            if (req.body[f] !== undefined) update[f] = req.body[f];
        }
        await ref.update(update);
        const updated = await ref.get();
        res.json(toObj(updated));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /exercises/:id
app.delete('/exercises/:id', requireApiKey, async (req, res) => {
    try {
        const ref = exercisesRef().doc(req.params.id);
        if (!(await ref.get()).exists) return res.status(404).json({ error: 'Exercise not found' });
        await ref.delete();
        res.status(204).send();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// LOG ROUTES
// ============================================================

// GET /logs
app.get('/logs', requireApiKey, async (req, res) => {
    try {
        let q = logsRef();
        if (req.query.exerciseId) q = q.where('Exercise_ID', '==', req.query.exerciseId);
        if (req.query.date) q = q.where('Date', '==', req.query.date);
        const snap = await q.get();
        let results = snap.docs.map(toObj);
        // Sort in memory to avoid requiring composite Firestore indexes
        results.sort((a, b) => (b.Date || '').localeCompare(a.Date || ''));
        if (req.query.limit) results = results.slice(0, parseInt(req.query.limit, 10));
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /logs
app.post('/logs', requireApiKey, async (req, res) => {
    try {
        const { Exercise_ID, Date: date, SetNumber, Actual_Reps, Weight_Used, Pain_Level, Variation } = req.body;
        if (!Exercise_ID || !date) return res.status(400).json({ error: 'Exercise_ID and Date are required' });
        const data = { Exercise_ID, Date: date, SetNumber: SetNumber ?? null, Actual_Reps: Actual_Reps ?? null, Weight_Used: Weight_Used ?? null, Pain_Level: Pain_Level ?? null, Variation: Variation ?? '' };
        const ref = await logsRef().add(data);
        res.status(201).json({ id: ref.id, ...data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /logs/:id
app.get('/logs/:id', requireApiKey, async (req, res) => {
    try {
        const doc = await logsRef().doc(req.params.id).get();
        if (!doc.exists) return res.status(404).json({ error: 'Log not found' });
        res.json(toObj(doc));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /logs/:id
app.delete('/logs/:id', requireApiKey, async (req, res) => {
    try {
        const ref = logsRef().doc(req.params.id);
        if (!(await ref.get()).exists) return res.status(404).json({ error: 'Log not found' });
        await ref.delete();
        res.status(204).send();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// HEALTH
// ============================================================

app.get('/health', (_req, res) => res.json({ status: 'ok', user: USER_ID }));

// ============================================================
// SWAGGER / OPENAPI
// ============================================================

const swaggerSpec = {
    openapi: '3.0.0',
    info: {
        title: 'Mobility with Simon API',
        version: '1.0.0',
        description: 'REST API for reading and writing exercise programs and workout logs. Scoped to a single Firebase user via the `USER_ID` environment variable. Authenticate all requests with the `x-api-key` header.'
    },
    servers: [{ url: `http://localhost:${PORT}`, description: 'Local dev' }],
    components: {
        securitySchemes: {
            ApiKeyAuth: {
                type: 'apiKey',
                in: 'header',
                name: 'x-api-key',
                description: 'Value of the `API_KEY` environment variable'
            }
        },
        schemas: {
            Exercise: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'Firestore document ID', example: 'abc123' },
                    Name: { type: 'string', example: 'Hip Flexor Stretch' },
                    Focus_Area: { type: 'string', example: 'Hips' },
                    Target_Sets: { type: 'integer', example: 3 },
                    Target_Reps: { type: 'integer', example: 12 },
                    Weight_Used_Initial: { type: 'number', example: 0 },
                    Video_Link: { type: 'string', example: 'https://youtube.com/watch?v=...' },
                    Physio_Notes: { type: 'string', example: 'Keep spine neutral throughout.' },
                    order: { type: 'integer', example: 1 }
                }
            },
            ExerciseInput: {
                type: 'object',
                required: ['Name'],
                properties: {
                    Name: { type: 'string' },
                    Focus_Area: { type: 'string' },
                    Target_Sets: { type: 'integer' },
                    Target_Reps: { type: 'integer' },
                    Weight_Used_Initial: { type: 'number' },
                    Video_Link: { type: 'string' },
                    Physio_Notes: { type: 'string' },
                    order: { type: 'integer' }
                }
            },
            Log: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'Firestore document ID', example: 'xyz789' },
                    Exercise_ID: { type: 'string', example: 'abc123' },
                    Date: { type: 'string', format: 'date', example: '2026-06-01' },
                    SetNumber: { type: 'integer', example: 1 },
                    Actual_Reps: { type: 'integer', example: 12 },
                    Weight_Used: { type: 'number', example: 10 },
                    Pain_Level: { type: 'integer', example: 2, description: '0–10 scale; 0 = no pain' },
                    Variation: { type: 'string', example: 'Banded' }
                }
            },
            LogInput: {
                type: 'object',
                required: ['Exercise_ID', 'Date'],
                properties: {
                    Exercise_ID: { type: 'string' },
                    Date: { type: 'string', format: 'date', description: 'YYYY-MM-DD' },
                    SetNumber: { type: 'integer' },
                    Actual_Reps: { type: 'integer' },
                    Weight_Used: { type: 'number' },
                    Pain_Level: { type: 'integer', description: '0–10 scale' },
                    Variation: { type: 'string' }
                }
            },
            Error: {
                type: 'object',
                properties: { error: { type: 'string' } }
            }
        }
    },
    security: [{ ApiKeyAuth: [] }],
    paths: {
        '/health': {
            get: {
                tags: ['System'],
                summary: 'Health check',
                security: [],
                responses: {
                    '200': { description: 'API is running', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string' }, user: { type: 'string' } } } } } }
                }
            }
        },
        '/exercises': {
            get: {
                tags: ['Exercises'],
                summary: 'List all exercises',
                description: 'Returns all exercises in the program ordered by the `order` field.',
                responses: {
                    '200': { description: 'Array of exercises', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Exercise' } } } } },
                    '401': { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
                    '500': { description: 'Server error' }
                }
            },
            post: {
                tags: ['Exercises'],
                summary: 'Create a new exercise',
                requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ExerciseInput' } } } },
                responses: {
                    '201': { description: 'Exercise created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Exercise' } } } },
                    '400': { description: 'Name is required', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
                    '401': { description: 'Unauthorized' }
                }
            }
        },
        '/exercises/{id}': {
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Firestore exercise document ID' }],
            get: {
                tags: ['Exercises'],
                summary: 'Get a single exercise',
                responses: {
                    '200': { description: 'Exercise', content: { 'application/json': { schema: { $ref: '#/components/schemas/Exercise' } } } },
                    '404': { description: 'Not found' }
                }
            },
            put: {
                tags: ['Exercises'],
                summary: 'Update an exercise',
                description: 'Partial update — only provided fields are changed.',
                requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ExerciseInput' } } } },
                responses: {
                    '200': { description: 'Updated exercise', content: { 'application/json': { schema: { $ref: '#/components/schemas/Exercise' } } } },
                    '404': { description: 'Not found' }
                }
            },
            delete: {
                tags: ['Exercises'],
                summary: 'Delete an exercise',
                responses: {
                    '204': { description: 'Deleted' },
                    '404': { description: 'Not found' }
                }
            }
        },
        '/logs': {
            get: {
                tags: ['Logs'],
                summary: 'List workout logs',
                description: 'Returns logs ordered by date descending. Combine `exerciseId` and `limit` to get recent sets for a specific exercise.',
                parameters: [
                    { name: 'exerciseId', in: 'query', schema: { type: 'string' }, description: 'Filter by exercise ID' },
                    { name: 'date', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Filter by exact date (YYYY-MM-DD)' },
                    { name: 'limit', in: 'query', schema: { type: 'integer' }, description: 'Max number of results to return' }
                ],
                responses: {
                    '200': { description: 'Array of log entries', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Log' } } } } },
                    '401': { description: 'Unauthorized' }
                }
            },
            post: {
                tags: ['Logs'],
                summary: 'Log a workout set',
                requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/LogInput' } } } },
                responses: {
                    '201': { description: 'Log entry created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Log' } } } },
                    '400': { description: 'Exercise_ID and Date are required' },
                    '401': { description: 'Unauthorized' }
                }
            }
        },
        '/logs/{id}': {
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Firestore log document ID' }],
            get: {
                tags: ['Logs'],
                summary: 'Get a single log entry',
                responses: {
                    '200': { description: 'Log entry', content: { 'application/json': { schema: { $ref: '#/components/schemas/Log' } } } },
                    '404': { description: 'Not found' }
                }
            },
            delete: {
                tags: ['Logs'],
                summary: 'Delete a log entry',
                responses: {
                    '204': { description: 'Deleted' },
                    '404': { description: 'Not found' }
                }
            }
        }
    }
};

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'Mobility API Docs'
}));

// Machine-readable OpenAPI spec (useful for LLM tool configuration)
app.get('/openapi.json', (_req, res) => res.json(swaggerSpec));

app.listen(PORT, () => {
    console.log(`\nMobility API running at http://localhost:${PORT}`);
    console.log(`Swagger docs:         http://localhost:${PORT}/docs`);
    console.log(`OpenAPI spec (JSON):  http://localhost:${PORT}/openapi.json\n`);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    GOOGLE_HANDWRITING_ENDPOINT,
    sanitizeStrokes,
    buildHandwritingPayload,
    parseHandwritingResponse,
    recognizeFallback,
    recognizeHandwriting,
} from '../lib/study/handwritingService.ts';

test('sanitizeStrokes formats stroke coordinates as [[x_coords], [y_coords], [timestamps]]', () => {
    const raw = [
        [[10.4, 50.8, 120.2], [20.1, 21.9, 22.0], [0, 18.4, 35.9]],
        [[], [], []],
    ];
    const clean = sanitizeStrokes(raw);
    assert.equal(clean.length, 1);
    assert.deepEqual(clean[0], [
        [10, 51, 120],
        [20, 22, 22],
        [0, 18, 36],
    ]);
});

test('buildHandwritingPayload constructs valid Google Input Tools IME request payload', () => {
    const strokes = [[[12, 180], [90, 90], [0, 48]]];
    const payload = buildHandwritingPayload(strokes, 320, 230, 8);
    assert.equal(payload.requests.length, 1);
    assert.equal(payload.requests[0].language, 'ja');
    assert.equal(payload.requests[0].max_num_results, 8);
    assert.deepEqual(payload.requests[0].writing_guide, {
        writing_area_width: 320,
        writing_area_height: 230,
    });
    assert.deepEqual(payload.requests[0].ink, strokes);
});

test('parseHandwritingResponse extracts and deduplicates top candidates from Google IME response', () => {
    const mockResponse = [
        'SUCCESS',
        [
            [
                'trace-0',
                ['日', '目', '白', '口', '日', '田', '旧', '旦', '百', '自'],
                [],
                {},
            ],
        ],
    ];
    const candidates = parseHandwritingResponse(mockResponse, 8);
    assert.deepEqual(candidates, ['日', '目', '白', '口', '田', '旧', '旦', '百']);
    assert.deepEqual(parseHandwritingResponse(['ERROR'], 8), []);
    assert.deepEqual(parseHandwritingResponse(null, 8), []);
});

test('recognizeHandwriting calls Google Input Tools API and gracefully falls back on network failure', async () => {
    const strokes = [
        [[20, 200], [100, 100], [0, 50]],
        [[110, 110], [20, 190], [80, 140]],
    ];

    let calledUrl = '';
    const okResult = await recognizeHandwriting(strokes, {
        width: 320,
        height: 230,
        maxResults: 6,
        fetchImpl: async (url) => {
            calledUrl = String(url);
            return new Response(
                JSON.stringify(['SUCCESS', [['0', ['十', '七', '土', '千', 'ナ', 'メ', '木']]]]),
                { status: 200 }
            );
        },
    });
    assert.equal(calledUrl, GOOGLE_HANDWRITING_ENDPOINT);
    assert.equal(okResult.source, 'google-ime');
    assert.deepEqual(okResult.candidates, ['十', '七', '土', '千', 'ナ', 'メ']);

    const fallbackResult = await recognizeHandwriting(strokes, {
        maxResults: 6,
        fetchImpl: async () => {
            throw new Error('Network unreachable');
        },
    });
    assert.equal(fallbackResult.source, 'fallback');
    assert.equal(fallbackResult.candidates.length, 6);
    assert.ok(fallbackResult.candidates.includes('十') || fallbackResult.candidates.includes('二'));

    const emptyResult = await recognizeHandwriting([]);
    assert.deepEqual(emptyResult.candidates, []);
    assert.equal(emptyResult.source, 'google-ime');
    assert.ok(recognizeFallback(strokes, 320, 230, 8).length >= 6);
});

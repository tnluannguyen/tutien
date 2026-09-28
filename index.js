const express = require("express");
const { addonBuilder } = require("stremio-addon-sdk");

const manifest = {
    id: "org.tutienhoi.addon",
    version: "1.0.0",
    name: "Góc Phim",
    description: "Addon xem phim từ Góc Phim",
    types: ["series"],
    catalogs: [{
        type: "series",
        id: "tutienhoi_catalog",
        name: "Góc Phim"
    }],
    resources: ["catalog", "meta", "stream"],
    idPrefixes: ["tth_"]
};

const builder = new addonBuilder(manifest);

let currentCookie = null;
let lastLoginTime = 0;
let catalogCache = null;
let catalogCacheTime = 0;

async function ensureAuth() {
    const now = Date.now();
    const randomHours = Math.floor(Math.random() * (8 - 3 + 1) + 3);
    const maxAge = randomHours * 60 * 60 * 1000;

    if (currentCookie && (now - lastLoginTime < maxAge)) {
        return currentCookie;
    }

    const username = process.env.TUTIENHOI_USERNAME;
    const password = process.env.TUTIENHOI_PASSWORD;

    if (!username || !password) {
        throw new Error("Missing credentials");
    }

    const response = await fetch("https://tutienhoi.vercel.app/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
    });

    const setCookieHeader = response.headers.get("set-cookie");
    if (setCookieHeader) {
        currentCookie = setCookieHeader.split(";")[0];
        lastLoginTime = now;
    }
    return currentCookie;
}

async function getCatalogData() {
    const now = Date.now();
    if (catalogCache && (now - catalogCacheTime < 15 * 60 * 1000)) {
        return catalogCache;
    }
    const cookie = await ensureAuth();
    const response = await fetch("https://tutienhoi.vercel.app/api/catalog", {
        headers: { "Cookie": cookie }
    });
    const data = await response.json();
    catalogCache = data.movies || [];
    catalogCacheTime = now;
    return catalogCache;
}

builder.defineCatalogHandler(async ({ type, id }) => {
    if (type !== "series" || id !== "tutienhoi_catalog") {
        return { metas: [] };
    }
    try {
        const movies = await getCatalogData();
        const metas = movies.map(m => ({
            id: `tth_${m.id}`,
            type: "series",
            name: m.title,
            poster: m.poster,
            description: m.description,
            genres: m.genre ? m.genre.split(" / ") : []
        }));
        return { metas };
    } catch (error) {
        return { metas: [] };
    }
});

builder.defineMetaHandler(async ({ type, id }) => {
    if (type !== "series" || !id.startsWith("tth_")) {
        return { meta: {} };
    }
    try {
        const movieId = parseInt(id.replace("tth_", ""));
        const movies = await getCatalogData();
        const movie = movies.find(m => m.id === movieId);
        
        if (!movie) {
            return { meta: {} };
        }

        const videos = (movie.episodes || []).map(ep => ({
            id: `tth_${movie.id}:${ep.id}`,
            title: ep.title,
            season: 1,
            episode: ep.position,
            released: new Date().toISOString()
        }));

        return {
            meta: {
                id,
                type: "series",
                name: movie.title,
                poster: movie.poster,
                description: movie.description,
                genres: movie.genre ? movie.genre.split(" / ") : [],
                videos
            }
        };
    } catch (error) {
        return { meta: {} };
    }
});

builder.defineStreamHandler(async ({ type, id }) => {
    if (type !== "series" || !id.startsWith("tth_")) {
        return { streams: [] };
    }
    try {
        const parts = id.split(":");
        if (parts.length < 2) {
            return { streams: [] };
        }
        const episodeId = parseInt(parts[1]);

        const cookie = await ensureAuth();
        const response = await fetch("https://tutienhoi.vercel.app/api/play", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Cookie": cookie
            },
            body: JSON.stringify({ episodeId })
        });
        const data = await response.json();

        if (data.source) {
            return {
                streams: [{
                    url: data.source,
                    title: data.title || "Góc Phim"
                }]
            };
        }
        return { streams: [] };
    } catch (error) {
        return { streams: [] };
    }
});

const app = express();
const { getRouter } = require("stremio-addon-sdk");
app.use(getRouter(builder.getInterface()));

if (process.env.VERCEL) {
    module.exports = app;
} else {
    const port = process.env.PORT || 7000;
    app.listen(port);
}

/*
 * Copyright victorfernandesraton, opencode
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { sanitizeCypher } from "../../src/cypher-sanitizer"
import { extractQuerySummary } from "../../src/query-summary"

describe("cypher-queries (fixtures sinteticas)", () => {
  describe("sanitizeCypher", () => {
    it("CASE com IN list, string vazia e EXISTS subquery", () => {
      const query = `
        MATCH (author:User)-[:OWNS]->(post:Post {post_id: $postId})
        WHERE (post.deleted_at IS NULL OR post.deleted_at = '')
        RETURN CASE
          WHEN post.visibility = 'only_me' THEN $viewerId = author.user_id
          WHEN post.visibility = 'public' THEN true
          WHEN post.type IN ['repost', 'secondary'] THEN true
          WHEN ($viewerId IS NOT NULL AND EXISTS {
            MATCH (u:User {user_id: $viewerId})-[:FOLLOWS {active: true}]->(:Feed)<-[:IN_FEED]-(post)
          }) THEN true
          ELSE false
        END AS can_access
      `
      const sanitized = sanitizeCypher(query)

      assert.ok(!sanitized.includes("'only_me'"))
      assert.ok(!sanitized.includes("'public'"))
      assert.ok(!sanitized.includes("'repost'"))
      assert.ok(!sanitized.includes("''"))
      assert.ok(sanitized.includes("post.deleted_at = ?"))
      assert.ok(sanitized.includes("IN [?]"))
      assert.ok(sanitized.includes("THEN ?"))
      assert.ok(sanitized.includes("ELSE ?"))
      assert.ok(sanitized.includes("{active: ?}"))
      assert.ok(sanitized.includes("$viewerId"))
      assert.ok(sanitized.includes("$postId"))
    })

    it("collect/head/UNWIND com CASE e LIMIT", () => {
      const query = `
        MATCH (me:User {user_id: $userId})
        OPTIONAL MATCH (me)-[:FOLLOWS {active: true}]->(author:User)-[:OWNS]->(post:Post)
        WHERE coalesce(post.deleted_at,'') = '' AND coalesce(post.draft,false) = false
        WITH me, collect(DISTINCT post) AS own_posts
        OPTIONAL MATCH (feed:Feed)<-[:IN_FEED]-(fp:Post)<-[:OWNS]-(fa:User)
        WITH me, own_posts, feed, fa, head(collect(fp)) AS deduped
        WITH me, own_posts + collect(deduped) AS all_posts
        UNWIND all_posts AS post
        WITH me, post, CASE WHEN EXISTS((me)-[:VIEWED]->(post)) THEN 1 ELSE 0 END AS viewed
        ORDER BY viewed ASC, datetime(post.created_at) DESC, post.post_id DESC
        LIMIT 25
        RETURN DISTINCT post.post_id AS id, viewed
      `
      const sanitized = sanitizeCypher(query)

      assert.ok(sanitized.includes("{active: ?}"))
      assert.ok(sanitized.includes("coalesce(post.deleted_at,?) = ?"))
      assert.ok(sanitized.includes("coalesce(post.draft,?) = ?"))
      assert.ok(sanitized.includes("THEN ? ELSE ? END"))
      assert.ok(sanitized.includes("LIMIT ?"))
      assert.ok(sanitized.includes("$userId"))
      assert.ok(!sanitized.includes("'"))
    })

    it("duration map com temporal", () => {
      const query = `
        MATCH (me:User {user_id: $userId})
        MATCH (post:Post)
        WHERE datetime(post.created_at) > datetime() - duration({days: 90})
        RETURN post.post_id AS id
      `
      const sanitized = sanitizeCypher(query)

      assert.ok(sanitized.includes("duration({days: ?})"))
      assert.ok(sanitized.includes("$userId"))
    })

    it("MERGE com ON CREATE SET", () => {
      const query = `
        MERGE (e:EmotionType {name: $name})
        ON CREATE SET e.description = $description
      `
      const sanitized = sanitizeCypher(query)

      assert.strictEqual(sanitized.trim(), query.trim())
    })

    it("QPE com list comprehension", () => {
      const query = `
        MATCH SHORTEST 1 (a:Place {name: $origin})(()-[:ROAD]->()){1,}(b:Place {name: $dest})
        RETURN [n IN nodes(p) | n.name] AS route
        ORDER BY length(p) LIMIT 5
      `
      const sanitized = sanitizeCypher(query)

      assert.ok(sanitized.includes("{1,}"))
      assert.ok(sanitized.includes("SHORTEST ?"))
      assert.ok(sanitized.includes("LIMIT ?"))
      assert.ok(sanitized.includes("$origin"))
      assert.ok(sanitized.includes("$dest"))
    })

    it("conditional CALL subquery com dynamic rel type", () => {
      const query = `
        MATCH (m:Item {id: $id})
        OPTIONAL MATCH (before:Item {id: $before})
        CALL (m, before) {
          WHEN before IS NULL THEN {
            CREATE (m)-[:NEXT]->(m)
          }
          ELSE {
            CREATE (m)-[:$($relType)]->(before)
          }
        }
      `
      const sanitized = sanitizeCypher(query)

      assert.ok(sanitized.includes("WHEN before IS NULL"))
      assert.ok(sanitized.includes("[:$($relType)]"))
      assert.ok(sanitized.includes("$id"))
      assert.ok(sanitized.includes("$before"))
    })

    it("LOAD CSV com CALL IN TRANSACTIONS", () => {
      const query = `
        LOAD CSV WITH HEADERS FROM 'file:///import.csv' AS row
        CALL (row) {
          MERGE (p:Product {sku: row.sku}) SET p += row
        } IN TRANSACTIONS OF 1000 ROWS
      `
      const sanitized = sanitizeCypher(query)

      assert.ok(!sanitized.includes("file:///import.csv"))
      assert.ok(sanitized.includes("FROM ? AS row"))
      assert.ok(sanitized.includes("IN TRANSACTIONS OF ? ROWS"))
      assert.ok(sanitized.includes("row.sku"))
    })

    it("UNWIND batch com SET NULL e DELETE", () => {
      const query = `
        UNWIND $rows AS row
        MATCH (p:Post {post_id: row.id})
        SET p.sequence_id = $seqId, p.parent_id = row.parent, p.position = row.position
        WITH p, row
        OPTIONAL MATCH (p)-[old:PREVIOUS]->()
        DELETE old
        WITH p, row WHERE row.parent IS NOT NULL
        MATCH (parent:Post {post_id: row.parent})
        MERGE (p)-[:PREVIOUS]->(parent)
      `
      const sanitized = sanitizeCypher(query)

      assert.ok(sanitized.includes("SET p.sequence_id = $seqId"))
      assert.ok(sanitized.includes("p.position = row.position"))
      assert.ok(sanitized.includes("WHERE row.parent IS NOT NULL"))
      assert.ok(sanitized.includes("$rows"))
    })

    it("point espacial", () => {
      const query = `
        SET n.coords = point({longitude: $lon, latitude: $lat})
        MATCH (a:Place {name: $origin}) MATCH (b:Place)
        RETURN b.name, point.distance(a.coords, b.coords) AS distM
        ORDER BY distM LIMIT 10
      `
      const sanitized = sanitizeCypher(query)

      assert.ok(sanitized.includes("point({longitude: $lon, latitude: $lat})"))
      assert.ok(sanitized.includes("point.distance(a.coords, b.coords)"))
      assert.ok(sanitized.includes("LIMIT ?"))
    })
  })

  describe("extractQuerySummary", () => {
    it("extrai clausulas do CASE query", () => {
      const query = `
        MATCH (author:User)-[:OWNS]->(post:Post {post_id: $postId})
        WHERE (post.deleted_at IS NULL OR post.deleted_at = '')
        RETURN CASE WHEN post.visibility = 'only_me' THEN true ELSE false END AS can_access
      `
      const summary = extractQuerySummary(query)

      assert.ok(summary.includes("MATCH"))
      assert.ok(summary.includes("RETURN"))
      assert.ok(!summary.includes("only_me"))
    })

    it("extrai clausulas do feed query com UNWIND", () => {
      const query = `
        MATCH (me:User {user_id: $userId})
        WITH me, collect(DISTINCT post) AS own_posts
        UNWIND own_posts AS post
        RETURN post.post_id AS id
      `
      const summary = extractQuerySummary(query)

      assert.ok(summary.includes("MATCH"))
      assert.ok(summary.includes("WITH"))
      assert.ok(summary.includes("UNWIND"))
      assert.ok(summary.includes("RETURN"))
    })

    it("extrai clausulas do LOAD CSV", () => {
      const query = `
        LOAD CSV WITH HEADERS FROM 'file:///import.csv' AS row
        CALL (row) { MERGE (p:Product {sku: row.sku}) SET p += row }
        IN TRANSACTIONS OF 1000 ROWS
      `
      const summary = extractQuerySummary(query)

      assert.ok(summary.includes("LOAD"))
      assert.ok(summary.includes("CALL"))
      assert.ok(summary.includes("MERGE"))
      assert.ok(summary.includes("SET"))
      assert.ok(!summary.includes("file:///import.csv"))
    })
  })
})

// AION Social Proxy
// Deploy: Web App - Execute as Me - Anyone can access
// Script Properties needed: NOTION_TOKEN

var NOTION_TOKEN_SOCIAL = PropertiesService.getScriptProperties().getProperty("NOTION_TOKEN");
var NOTION_VERSION_SOCIAL = "2022-06-28";

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var pageId = body.pageId;
    var instagramHandle = body.instagramHandle;
    var linkedinUrl = body.linkedinUrl;

    if (!pageId) return jsonResp({ ok: false, error: "missing pageId" });

    var requests = [];
    var keys = [];

    if (instagramHandle) {
      var handle = instagramHandle.replace(/^@/, "").trim();
      requests.push({
        url: "https://i.instagram.com/api/v1/users/web_profile_info/?username=" + encodeURIComponent(handle),
        method: "get",
        headers: {
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
          "X-IG-App-ID": "936619743392459",
          "Accept": "*/*",
          "Accept-Language": "es-ES,es;q=0.9",
          "Referer": "https://www.instagram.com/"
        },
        muteHttpExceptions: true
      });
      keys.push({ type: "instagram", handle: handle });
    }

    if (linkedinUrl) {
      requests.push({
        url: linkedinUrl.replace(/\/?$/, "/"),
        method: "get",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
        },
        muteHttpExceptions: true,
        followRedirects: true
      });
      keys.push({ type: "linkedin", url: linkedinUrl });
    }

    if (requests.length === 0) return jsonResp({ ok: true, skipped: true });

    var responses = UrlFetchApp.fetchAll(requests);
    var written = {};

    for (var i = 0; i < responses.length; i++) {
      var meta = keys[i];
      if (meta.type === "instagram") {
        var igResult = parseInstagram(responses[i], meta.handle);
        if (igResult) {
          writeNotionBlock(pageId, "instagram", igResult);
          written.instagram = igResult;
        }
      } else if (meta.type === "linkedin") {
        var liResult = parseLinkedIn(responses[i], meta.url);
        if (liResult) {
          writeNotionBlock(pageId, "linkedin", liResult);
          written.linkedin = liResult;
        }
      }
    }

    return jsonResp({ ok: true, written: written });

  } catch (err) {
    return jsonResp({ ok: false, error: String(err) });
  }
}

function parseInstagram(resp, handle) {
  try {
    if (resp.getResponseCode() === 200) {
      var data = JSON.parse(resp.getContentText());
      var user = data && data.data && data.data.user;
      if (user) {
        var followers = (user.edge_followed_by && user.edge_followed_by.count) || 0;
        var following = (user.edge_follow && user.edge_follow.count) || 0;
        var posts = (user.edge_owner_to_timeline_media && user.edge_owner_to_timeline_media.count) || 0;
        var engagementRate = null;
        var edges = (user.edge_owner_to_timeline_media && user.edge_owner_to_timeline_media.edges) || [];
        if (edges.length >= 3 && followers > 0) {
          var recent = edges.slice(0, 12);
          var total = 0;
          for (var i = 0; i < recent.length; i++) {
            total += ((recent[i].node && recent[i].node.edge_liked_by && recent[i].node.edge_liked_by.count) || 0);
            total += ((recent[i].node && recent[i].node.edge_media_to_comment && recent[i].node.edge_media_to_comment.count) || 0);
          }
          engagementRate = Math.round(total / recent.length / followers * 10000) / 100;
        }
        return {
          found: true,
          handle: handle,
          url: "https://www.instagram.com/" + handle + "/",
          followers: followers,
          following: following,
          posts: posts,
          bio: (user.biography || "").slice(0, 300),
          isVerified: user.is_verified || false,
          isBusinessAccount: user.is_business_account || false,
          businessCategory: user.business_category_name || null,
          engagementRate: engagementRate
        };
      }
    }
  } catch (err) {
    // fall through to HTML fallback
  }
  return fetchInstagramHtmlFallback(handle);
}

function fetchInstagramHtmlFallback(handle) {
  try {
    var r = UrlFetchApp.fetch("https://www.instagram.com/" + handle + "/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        "Accept": "text/html"
      },
      muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) {
      return { found: false, handle: handle, reason: "http_" + r.getResponseCode() };
    }
    var html = r.getContentText();
    var followers = extractRegexNumber(html, /"edge_followed_by":\{"count":(\d+)\}/);
    var posts = extractRegexNumber(html, /"edge_owner_to_timeline_media":\{"count":(\d+)\}/);
    if (!followers) {
      var desc = extractMeta(html, "og:description");
      if (desc) {
        var fm = desc.match(/([\d,\.]+(?:\s*[KkMm])?)\s*(?:Followers|seguidores)/i);
        if (fm) followers = parseFollowerStr(fm[1]);
      }
    }
    return {
      found: true,
      handle: handle,
      url: "https://www.instagram.com/" + handle + "/",
      followers: followers || null,
      posts: posts || null,
      reason: "html_fallback"
    };
  } catch (err) {
    return { found: false, handle: handle, reason: "fetch_failed" };
  }
}

function parseLinkedIn(resp, inputUrl) {
  try {
    var code = resp.getResponseCode();
    if (code !== 200) return { found: false, url: inputUrl, reason: "http_" + code };
    var html = resp.getContentText();
    var title = extractMeta(html, "og:title") || "";
    var description = extractMeta(html, "og:description") || "";
    var followers = null;
    var industry = null;
    var employees = null;
    if (description) {
      var fm = description.match(/([\d,\.]+(?:\s*[KkMm])?)\s+(?:followers|seguidores)/i);
      if (fm) followers = parseFollowerStr(fm[1]);
      var parts = description.split("\u00B7");
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i].trim();
        if (!p.match(/^\d/) && p.length > 2 && p.length < 80 && !p.match(/followers|seguidores/i)) {
          industry = p;
          break;
        }
      }
    }
    var empMatch = html.match(/([\d,]+(?:\s*[KkMm])?)\s*(?:employees|empleados)/i);
    if (empMatch) employees = empMatch[1].trim();
    return {
      found: true,
      url: inputUrl,
      name: title ? title.replace(/\s*\|\s*LinkedIn\s*$/, "").trim() : null,
      followers: followers || null,
      employees: employees || null,
      industry: industry || null,
      description: description ? description.slice(0, 300) : null
    };
  } catch (err) {
    return { found: false, url: inputUrl, reason: "parse_failed" };
  }
}

function writeNotionBlock(pageId, moduleKey, data) {
  var content = JSON.stringify({ m: moduleKey, d: data }).slice(0, 1990);
  var payload = {
    children: [{
      object: "block",
      type: "code",
      code: {
        rich_text: [{ type: "text", text: { content: content } }],
        language: "json"
      }
    }]
  };
  UrlFetchApp.fetch("https://api.notion.com/v1/blocks/" + pageId + "/children", {
    method: "patch",
    contentType: "application/json",
    headers: {
      "Authorization": "Bearer " + NOTION_TOKEN_SOCIAL,
      "Notion-Version": NOTION_VERSION_SOCIAL
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

function extractMeta(html, property) {
  var re = new RegExp("<meta[^>]+(?:property|name)=[\"']" + property + "[\"'][^>]+content=[\"']([^\"']+)[\"']", "i");
  var m = html.match(re);
  if (m) return m[1];
  var re2 = new RegExp("<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+(?:property|name)=[\"']" + property + "[\"']", "i");
  var m2 = html.match(re2);
  return m2 ? m2[1] : null;
}

function extractRegexNumber(text, regex) {
  var m = text && text.match(regex);
  if (!m) return null;
  var n = parseInt(m[1].replace(/[,\.]/g, ""), 10);
  return isNaN(n) ? null : n;
}

function parseFollowerStr(str) {
  if (!str) return null;
  var clean = String(str).replace(/,/g, "").trim();
  if (/k$/i.test(clean)) return Math.round(parseFloat(clean) * 1000);
  if (/m$/i.test(clean)) return Math.round(parseFloat(clean) * 1000000);
  var n = parseInt(clean, 10);
  return isNaN(n) ? null : n;
}

function jsonResp(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

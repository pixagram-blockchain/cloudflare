export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Handle CORS Preflight (OPTIONS requests)
    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    // Check if the environment variable is set
    if (!env.NODE_URL) {
      return new Response(
        JSON.stringify({ error: "Configuration Error", details: "NODE_URL is not set in environment variables." }), 
        {
          status: 500,
          headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*" 
          }
        }
      );
    }

    // 2. Handle the Actual Request using the env variable
    return handleProxy(request, url, env.NODE_URL);
  }
};

async function handleProxy(request, url, backendUrl) {
  // Construct the target URL (e.g., http://rpc.pixagram.io:7778/v1/users)
  const targetPath = url.pathname + url.search;
  const targetUrl = backendUrl + targetPath;

  // Clone the request to modify headers
  const proxyRequest = new Request(targetUrl, {
    method: request.method,
    headers: new Headers(request.headers),
    body: request.body,
    redirect: "follow"
  });

  // SPOOFING: Host/Origin must match the backend so it accepts the request
  try {
    const backendUrlObj = new URL(backendUrl);
    proxyRequest.headers.set("Host", backendUrlObj.host);
    proxyRequest.headers.set("Origin", backendUrlObj.origin);
  } catch (e) {
     return new Response(JSON.stringify({ error: "Configuration Error", details: "Invalid NODE_URL format." }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  try {
    const response = await fetch(proxyRequest);

    // Create a new response to modify headers for the browser
    const modifiedResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers)
    });

    // CORS: Allow Everyone (*)
    modifiedResponse.headers.set("Access-Control-Allow-Origin", "*");
    modifiedResponse.headers.set("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, DELETE, OPTIONS");
    modifiedResponse.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

    return modifiedResponse;
  } catch (e) {
    return new Response(JSON.stringify({ error: "Proxy Error", details: e.message }), {
      status: 502,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*" // Allow error to be seen by everyone
      }
    });
  }
}

function handleOptions(request) {
  const headers = new Headers();
  
  // CORS: Allow Everyone (*)
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, DELETE, OPTIONS");
  
  // Allow whatever headers the client is asking to send
  const requestHeaders = request.headers.get("Access-Control-Request-Headers");
  if (requestHeaders) {
    headers.set("Access-Control-Allow-Headers", requestHeaders);
  } else {
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  }

  headers.set("Access-Control-Max-Age", "86400"); 

  return new Response(null, {
    headers: headers
  });
}

/*
+-----------+-------------------+-----------------------------+
| Type      | Name              | Value                       |
+-----------+-------------------+-----------------------------+
| Plaintext | NODE_URL          | http://rpc.pixagram.io:7778 |
+-----------+-------------------+-----------------------------+
*/

#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};
use trailbase_wasm::db::{Value, query};
use trailbase_wasm::http::{HttpError, HttpRoute, Json, Request, StatusCode, routing};
use trailbase_wasm::{Guest, export};

#[derive(Serialize)]
struct Record {
    id: i64,
    author: String,
    message: String,
    created_at: String,
}

#[derive(Deserialize)]
struct WriteRecord {
    author: String,
    message: String,
}

fn internal(error: impl ToString) -> HttpError {
    HttpError::message(StatusCode::INTERNAL_SERVER_ERROR, error)
}

fn record(row: Vec<Value>) -> Result<Record, HttpError> {
    let [
        Value::Integer(id),
        Value::Text(author),
        Value::Text(message),
        Value::Text(created_at),
    ] = row.as_slice()
    else {
        return Err(internal("invalid database row"));
    };
    Ok(Record {
        id: *id,
        author: author.clone(),
        message: message.clone(),
        created_at: created_at.clone(),
    })
}

async fn list(_req: Request) -> Result<Json<Vec<Record>>, HttpError> {
    let rows = query("SELECT id,author,message,created_at FROM bb_basic_js_v2_guestbook ORDER BY created_at DESC LIMIT 20", [])
        .await.map_err(internal)?;
    Ok(Json(
        rows.into_iter().map(record).collect::<Result<_, _>>()?,
    ))
}

async fn item(req: Request) -> Result<Json<Record>, HttpError> {
    let id = req
        .query_param("id")
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| HttpError::message(StatusCode::BAD_REQUEST, "invalid id"))?;
    let mut rows = query(
        "SELECT id,author,message,created_at FROM bb_basic_js_v2_guestbook WHERE id = $1",
        [Value::Integer(id)],
    )
    .await
    .map_err(internal)?;
    let row = rows
        .pop()
        .ok_or_else(|| HttpError::message(StatusCode::NOT_FOUND, "not found"))?;
    Ok(Json(record(row)?))
}

async fn write(mut req: Request) -> Result<Json<serde_json::Value>, HttpError> {
    let input = req
        .body()
        .json::<WriteRecord>()
        .await
        .map_err(|error| HttpError::message(StatusCode::BAD_REQUEST, error))?;
    let rows = query(
        "INSERT INTO bb_basic_js_v2_guestbook (author,message) VALUES ($1,$2) RETURNING id",
        [Value::Text(input.author), Value::Text(input.message)],
    )
    .await
    .map_err(internal)?;
    let Some(Value::Integer(id)) = rows.first().and_then(|row| row.first()) else {
        return Err(internal("insert did not return an id"));
    };
    Ok(Json(serde_json::json!({ "id": id })))
}

struct Component;
impl Guest for Component {
    fn http_handlers() -> Vec<HttpRoute> {
        vec![
            routing::get("/bb-basic-js-v2/list", list),
            routing::get("/bb-basic-js-v2/item", item),
            routing::post("/bb-basic-js-v2/write", write),
        ]
    }
}
export!(Component);

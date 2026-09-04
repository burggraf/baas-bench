package main

import (
	"log"
	"net/http"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

const table = "bb_basic_js_v2_guestbook"

type record struct {
	ID        string `db:"id" json:"id"`
	Author    string `db:"author" json:"author"`
	Message   string `db:"message" json:"message"`
	CreatedAt string `db:"created_at" json:"created_at"`
}

type writeRecord struct {
	Author  string `json:"author"`
	Message string `json:"message"`
}

func main() {
	app := pocketbase.New()
	app.OnServe().BindFunc(func(event *core.ServeEvent) error {
		event.Router.GET("/bb-basic-js-v2/list", func(request *core.RequestEvent) error {
			rows := []record{}
			err := request.App.DB().NewQuery("SELECT id,author,message,created_at FROM " + table + " ORDER BY created_at DESC LIMIT 20").All(&rows)
			if err != nil {
				return err
			}
			return request.JSON(http.StatusOK, rows)
		})
		event.Router.GET("/bb-basic-js-v2/item", func(request *core.RequestEvent) error {
			id := request.Request.URL.Query().Get("id")
			if id == "" {
				return request.BadRequestError("invalid id", nil)
			}
			row := record{}
			err := request.App.DB().NewQuery("SELECT id,author,message,created_at FROM " + table + " WHERE id = {:id}").Bind(dbx.Params{"id": id}).One(&row)
			if err != nil {
				return err
			}
			return request.JSON(http.StatusOK, row)
		})
		event.Router.POST("/bb-basic-js-v2/write", func(request *core.RequestEvent) error {
			input := writeRecord{}
			if err := request.BindBody(&input); err != nil {
				return request.BadRequestError("invalid body", err)
			}
			collection, err := request.App.FindCollectionByNameOrId(table)
			if err != nil {
				return err
			}
			row := core.NewRecord(collection)
			row.Set("author", input.Author)
			row.Set("message", input.Message)
			if err := request.App.Save(row); err != nil {
				return err
			}
			return request.JSON(http.StatusOK, map[string]string{"id": row.Id})
		})
		return event.Next()
	})
	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}

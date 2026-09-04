ARG GO_IMAGE
FROM ${GO_IMAGE} AS build
WORKDIR /src
COPY benchmark-sets/basic-js-v2/shared/pocketbase-go/go.mod benchmark-sets/basic-js-v2/shared/pocketbase-go/go.sum ./
RUN go mod download
COPY benchmark-sets/basic-js-v2/shared/pocketbase-go/main.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /pocketbase .

FROM scratch
COPY --from=build /pocketbase /pb/pocketbase
EXPOSE 8090
CMD ["/pb/pocketbase", "serve", "--dir=/pb/pb_data", "--http=0.0.0.0:8090"]

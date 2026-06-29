// const express = require('express');
// const cors = require("cors");
// const app = express()
// const port = 8000
// require("dotenv").config()
// app.use(cors());
// app.use(express.json());

// const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
// app.get('/', (req, res) => {
//   res.send('Hello World!')
// })

// //Mongodb Start
// const uri = process.env.MONGODB_URI;

// // Create a MongoClient with a MongoClientOptions object to set the Stable API version
// const client = new MongoClient(uri, {
//   serverApi: {
//     version: ServerApiVersion.v1,
//     strict: true,
//     deprecationErrors: true,
//   }
// });

// async function run() {
//   try {
//     // Connect the client to the server	(optional starting in v4.7)
//     await client.connect();
//     // Send a ping to confirm a successful connection
// const database = client.db("recipe");
// const recipeCollection = database.collection("recipes");




// app.get("/api/recipes", async (req,res)=> {
// const query = {};

// if(req.query.companyId){
//     query.companyId = req.query.companyId;
// }
// if(req.query.status){
//     query.status = req.query.status;
// }
// const cursor = recipeCollection.find(query);
// const result = await cursor.toArray();
// res.send(result);
// })

// app.get("/api/recipes/:id", async (req,res) => {
//     const id = req.params.id;
//     const query = {
//         _id: new ObjectId(id)
//     }
//     const result = await recipeCollection.findOne(query);
//     res.send(result);
// })

// app.post("/api/recipes", async (req,res)=> {
//     const recipe = req.body;
//     const result = await recipeCollection.insertOne(recipe);
//     res.send(result);
// })



//     await client.db("admin").command({ ping: 1 });
//     console.log("Pinged your deployment. You successfully connected to MongoDB!");
//   } finally {
//     // Ensures that the client will close when you finish/error
    
//   }
// }
// run().catch(console.dir);

// //Mongodb end

// app.listen(port, () => {
//   console.log(`Example app listening on port ${port}`)
// })

//-------------------------------------------------------------------------------------------

const express = require('express');
const cors = require("cors");
const app = express();
const port = 8000;
require("dotenv").config();

app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

app.get('/', (req, res) => {
  res.send('Hello World!');
});

const PLAN_LIMITS = {
  free: 2,
  starter: 10,
  pro: 50,
  master: Infinity,
};

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();

    const database = client.db("recipe");
    const recipeCollection = database.collection("recipes");

    // GET all recipes (with optional filters)
    app.get("/api/recipes", async (req, res) => {
      const query = {};
      if (req.query.companyId) query.companyId = req.query.companyId;
      if (req.query.status)    query.status    = req.query.status;
      if (req.query.authorId)  query.authorId  = req.query.authorId;

      const cursor = recipeCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    // GET single recipe by ID
    app.get("/api/recipes/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await recipeCollection.findOne(query);
      res.send(result);
    });

    // GET recipe count by authorId
    // ⚠️ Must be defined BEFORE /api/recipes/:id to avoid "count" being treated as an ObjectId
    app.get("/api/recipes/count/:authorId", async (req, res) => {
      const { authorId } = req.params;
      const count = await recipeCollection.countDocuments({ authorId });
      res.send({ count });
    });

    // POST create recipe — with plan limit enforcement
    app.post("/api/recipes", async (req, res) => {
      const { userPlan, ...recipeData } = req.body;
      const authorId = recipeData.authorId;

      // Reject anonymous users
      if (!authorId || authorId === "anonymous") {
        return res.status(401).send({
          success: false,
          message: "You must be logged in to create a recipe.",
        });
      }

      // Resolve plan safely — unknown plans fall back to free
      const plan = (userPlan || "free").toLowerCase();
      const limit = Object.prototype.hasOwnProperty.call(PLAN_LIMITS, plan)
        ? PLAN_LIMITS[plan]
        : PLAN_LIMITS["free"];

      // Count existing recipes for this user
      const existingCount = await recipeCollection.countDocuments({ authorId });

      // ✅ THE KEY FIX: >= means "already AT the limit, don't allow one more"
      // free limit = 2: blocked when count is already 2 (has used both slots)
      if (existingCount >= limit) {
        return res.status(403).send({
          success: false,
          message: "LIMIT_REACHED",
          details: `Your ${plan} plan allows a maximum of ${limit} recipes. Please upgrade.`,
        });
      }

      // Insert recipe (userPlan is stripped — it's not recipe data)
      const result = await recipeCollection.insertOne({
        ...recipeData,
        createdAt: new Date(),
      });

      res.send({ success: true, insertedId: result.insertedId });
    });

    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

  } finally {
    // keep connection open
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});


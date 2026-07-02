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
// const port = 8000;
require("dotenv").config();

app.use(cors({
  origin: 'https://recipe-hub-client-orcin.vercel.app', // Allow only your frontend
  credentials: true
}));
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

app.get('/', (req, res) => {
  res.send('Hello World!');
});

// ✅ Keys must match what gets stored in user.plan after payment
const PLAN_LIMITS = {
  free:           2,
  seller_starter: 10,
  seller_pro:     50,
  seller_master:  Infinity,
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

    const database          = client.db("recipe");
    const recipeCollection  = database.collection("recipes");
    const userCollection    = database.collection("user");
    const subscriptionCollection = database.collection("subscriptions");

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
    // ⚠️ Must stay ABOVE /api/recipes/:id
    app.get("/api/recipes/count/:authorId", async (req, res) => {
      const { authorId } = req.params;
      const count = await recipeCollection.countDocuments({ authorId });
      res.send({ count });
    });

    // POST subscription — save sub + update user plan
    app.post("/api/subscriptions", async (req, res) => {
      const data = req.body;
      // data.planId will be e.g. "seller_starter", "seller_pro", "seller_master"

      // 1. Save subscription record
      const subsInfo = {
        ...data,
        createdAt: new Date(),
      };
      await subscriptionCollection.insertOne(subsInfo);

      // 2. ✅ Update user.plan to e.g. "seller_starter" — matches PLAN_LIMITS keys
      const userFilter = { email: data.email };
      const userUpdate = {
        $set: {
          plan:      data.planId,       // "seller_starter" / "seller_pro" / "seller_master"
          updatedAt: new Date(),
        },
      };
      const updateResult = await userCollection.updateOne(userFilter, userUpdate);

      // ✅ Single res.send() — no double-send crash
      res.send({
        success:  true,
        modified: updateResult.modifiedCount,
      });
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

      // ✅ Fetch the user's LIVE plan directly from DB — never trust the client
      const userDoc = await userCollection.findOne({ _id: new ObjectId(authorId) });
      const plan    = userDoc?.plan || "free";   // e.g. "seller_starter", "free"

      // ✅ Lookup limit — PLAN_LIMITS keys now match DB values exactly
      const limit = Object.prototype.hasOwnProperty.call(PLAN_LIMITS, plan)
        ? PLAN_LIMITS[plan]
        : PLAN_LIMITS["free"];

      // Count existing recipes for this user
      const existingCount = await recipeCollection.countDocuments({ authorId });

      console.log(`User: ${authorId} | Plan: ${plan} | Limit: ${limit} | Count: ${existingCount}`);

      if (existingCount >= limit) {
        return res.status(403).send({
          success: false,
          message: "LIMIT_REACHED",
          details: `Your ${plan} plan allows a maximum of ${limit === Infinity ? "unlimited" : limit} recipes. Please upgrade.`,
        });
      }

      // Insert recipe
      const result = await recipeCollection.insertOne({
        ...recipeData,
        createdAt: new Date(),
      });

      res.send({ success: true, insertedId: result.insertedId });
    });

    // await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

  } finally {
    // keep connection open
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});